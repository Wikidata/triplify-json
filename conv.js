'use strict';

const Fs = require('fs')
const N3 = require('n3')
const { Store, Quad, NamedNode, Literal, BlankNode, DataFactory } = N3
const { quad, namedNode, literal, blankNode } = DataFactory
const DEFAULT_QUADS_CUTOFF = 9999 // 20

function conv (qid, json_item) {
  const rdf_item = new Store()

  if (true)
    for (const pid in json_item.claims) {
      // Properties and their derivatives
      rdf_item.add(quad(wd(pid), RDF('type'), wikibase('Property')))
      rdf_item.add(quad(wd(pid), wikibase('directClaim'), wdt(pid)))
      rdf_item.add(quad(wd(pid), wikibase('claim'), p(pid)))
      rdf_item.add(quad(wd(pid), wikibase('statementProperty'), ps(pid)))
      rdf_item.add(quad(wd(pid), wikibase('statementValue'), psv(pid)))
      rdf_item.add(quad(wd(pid), wikibase('qualifier'), pq(pid)))
      rdf_item.add(quad(wd(pid), wikibase('qualifierValue'), pqv(pid)))
      rdf_item.add(quad(wd(pid), wikibase('reference'), pr(pid)))
      rdf_item.add(quad(wd(pid), wikibase('referenceValue'), prv(pid)))
      rdf_item.add(quad(wd(pid), wikibase('novalue'), wdno(pid)))
      rdf_item.add(quad(wd(pid), wikibase('propertyType'), namedNode(property_type[json_item['claims'][pid][0]["mainsnak"]["datatype"]])))

      // Statements
      for (const claim of json_item['claims'][pid]) {
        const statement_uri = s(claim["id"]);
        // rank
        if (claim["rank"] == "normal") {
          rdf_item.add(quad(statement_uri, wikibase('rank'), wikibase('NormalRank')))
        }
        if (claim["rank"] == "preferred") {
          rdf_item.add(quad(statement_uri, wikibase('rank'), wikibase('PreferredRank')))
        }
        if (claim["rank"] == "deprecated") {
          rdf_item.add(quad(statement_uri, wikibase('rank'), wikibase('DeprecatedRank')))
        }

        // values
        let preferredSet = false
        for (const claim2 in json_item['claims'][pid]) {
          if (claim2["rank"] == "preferred") {
            preferredSet = true
            break
          }
        }

        if (claim["mainsnak"]["snaktype"] === "novalue") {
          rdf_item.add(quad(statement_uri, RDF('type'), wdno('pid')))
        } else {
          parseClaimData(rdf_item, pid, qid, statement_uri, claim, preferredSet);
        }

        // wdt (truthy ststements are set when claims are either Preferred rank or when no preferred rank exist
        //      have normal rank. Statements with a deprecated rank are not reified in the truthy subgraph.)

        rdf_item.add(quad(wd(qid), p(pid), statement_uri))
        rdf_item.add(quad(statement_uri, RDF('type'), wikibase('Statement')))

        if (preferredSet) {
          if (claim["rank"] == "preferred") {
            rdf_item.add(quad(statement_uri, RDF('type'), wikibase('BestRank')))
          }
        } else {
          if (claim["rank"] == "normal") {
            rdf_item.add(quad(statement_uri, RDF('type'), wikibase('BestRank')))
          }
        }

        // qualifiers
        for (const qualifier in claim["qualifiers"]) {
          for (const qualifier_prop of claim["qualifiers"][qualifier]) {
            const object = parseSnak(qualifier_prop);
            rdf_item.add(quad(statement_uri, pq('qualifier'), object))
          }
        }

        // references
        for (let reference of claim["references"]) {
          const reference_uri = ref(reference["hash"])
          rdf_item.add(quad(reference_uri, RDF('type'), wikibase('Reference')))
          rdf_item.add(quad(statement_uri, prov('wasDerivedFrom'), reference_uri))

          for (let ref_prop in reference["snaks"]) {
            for (let ref_prop_statement of reference["snaks"][ref_prop]) {
              const value = parseSnak(ref_prop_statement)
              rdf_item.add(quad(reference_uri, pr('ref_prop'), value))
            }
          }
        }
      }

      for (const language in json_item["labels"]) {
        const l = new literal(json_item["labels"][language]["value"], language)
        const q = quad(wd(qid), rdfs('label'), l)
        rdf_item.addQuad(q)
      }

      for (const language in json_item["descriptions"])
        rdf_item.add(quad(wd(qid), schema('description'), literal(json_item["descriptions"][language]["value"], language)))

      for (const language in json_item["aliases"])
        for (const label of json_item["aliases"][language])
          rdf_item.add(quad(wd(qid), skos('altLabel'), literal(label.value, language)))
      
    }
  return rdf_item
}


function parseClaimData (rdf_item, pid, qid, statement_uri, claim, preferredSet) {
  const snak = claim["mainsnak"];

  let object = null;
  // first no value
  {
    // commonsMedia
    if (snak["datavalue"]["type"] == "commonsMedia") {
      object = URIRef("http://commons.wikimedia.org/wiki/Special:FilePath/"+snak["datavalue"]["value"].replace(" ", "_"))
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
    }

    // string
    if (snak["datavalue"]["type"] == "string") {
      object = literal(snak["datavalue"]["value"])
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
    }

    // wikibase-item
    if (snak["datatype"] == "wikibase-item") {
      object = wd(snak["datavalue"]["value"]["id"]);
      rdf_item.add(quad(statement_uri, ps('pid'), object ))
      makeWdt(claim, preferredSet, object)
    }

    // monolingual-text
    if (snak["datatype"] == "monolingualtext") {
      object = literal(snak["datavalue"]["value"]["text"], snak["datavalue"]["value"]["language"])
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
    }

    // 'geo-shape'
    if (snak["datatype"] == "geo-shape") {
      object = URIRef("http://commons.wikimedia.org/data/main/"+snak["datavalue"]["value"])
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
    }

    // 'globe-coordinate'
    if (snak["datatype"] == "globe-coordinate") {
      latitude = snak["datavalue"]["value"]["latitude"]
      longitude = snak["datavalue"]["value"]["longitude"]
      // altitude = snak["datavalue"]["value"]["altitude"] // not used
      precision = snak["datavalue"]["value"]["precision"] // not used
      globe = snak["datavalue"]["value"]["globe"]   // not used
      object = literal("Point("+str(longitude)+","+str(latitude)+")", datatype=geo.wktLiteral)
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
      // TODO Normalized values with units
    }

    // math
    // No statements exist that use Math datatype

    // quantity
    if (snak["datatype"] == "quantity") {
      amount = snak["datavalue"]["value"]["amount"]
      unit =  snak["datavalue"]["value"]["unit"]
      object = literal(snak["datavalue"]["value"]["amount"], datatype=xsd('decimal'))
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
      // TODO Normalized values with units
    }

    // tabular data
    // Not used in Wikidata

    // time
    if (snak["datatype"] == "time") {
      object = literal(snak["datavalue"]["value"]["time"], datatype=xsd('dateTime'))
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
      // TODO normalize
    }

    // url
    if (snak["datatype"] == "url") {
      object = URIRef(snak["datavalue"]["value"])
      rdf_item.add(quad(statement_uri, ps('pid'), object))
      makeWdt(claim, preferredSet, object)
    }
  }

  function makeWdt (claim, preferredSet, value) {
    if (preferredSet) {
      if (claim["rank"] == "preferred")
        rdf_item.add(quad(wd(qid), wdt(pid), value))
    } else {
      if (claim["rank"] == "normal")
        rdf_item.add(quad(wd(qid), wdt(pid), value))
    }
  }
}

function parseSnak (statement) {
  const value = statement["datavalue"]["value"];
  switch (statement["datatype"]) {
  case 'commonsMedia':
    return URIRef("http://commons.wikimedia.org/wiki/Special:FilePath/"+value.replace(" ", "_"))
  case 'string':
  case 'external-id': // !! check with Andra 
    return literal(value)
  case 'wikibase-item':
    return wd(value["id"])
  case 'monolingualtext':
    return literal(value["text"], value["language"])
  case 'geo-shape':
    return URIRef("http://commons.wikimedia.org/data/main/"+value)
  case 'globe-coordinate':
    const latitude = value["latitude"]
    const longitude = value["longitude"]
    // altitude = claim["mainsnak"]["datavalue"]["value"]["altitude"] // not used
    const precision = value["precision"] // not used
    const globe = value["globe"]   // not used
    return literal("Point("+str(longitude)+","+str(latitude)+")", geo.wktLiteral)
  case 'quantity':
    const amount = value["amount"]
    const unit =  value["unit"]
    return literal(value["amount"], xsd('decimal'))
  case 'url':
    return URIRef(value)
  case 'time':
    return literal(value["time"], xsd('dateTime'))
  default:
    throw Error('unknown snak datatype ' + statement["datatype"])
  }
}

const RDF = (ln) => namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#' + ln)
const skos = (ln) => namedNode('http://www.w3.org/2004/02/skos/core#' + ln)

const ontolex = (ln) => namedNode("http://www.w3.org/ns/lemon/ontolex#" + ln)
const dct = (ln) => namedNode("http://purl.org/dc/terms/" + ln)
const rdfs = (ln) => namedNode("http://www.w3.org/2000/01/rdf-schema#" + ln)
const wikibase = (ln) => namedNode("http://wikiba.se/ontology#" + ln)
const schema = (ln) => namedNode("http://schema.org/" + ln)
const cc = (ln) => namedNode("http://creativecommons.org/ns#" + ln)
const geo = (ln) => namedNode("http://www.opengis.net/ont/geosparql#" + ln)
const prov = (ln) => namedNode("http://www.w3.org/ns/prov#" + ln)
const wd = (ln) => namedNode("http://www.wikidata.org/entity/" + ln)
const data = (ln) => namedNode("https://www.wikidata.org/wiki/Special:EntityData/" + ln)
const s = (ln) => namedNode("http://www.wikidata.org/entity/statement/" + ln)
const ref = (ln) => namedNode("http://www.wikidata.org/reference/" + ln)
const v = (ln) => namedNode("http://www.wikidata.org/value/" + ln)
const wdt = (ln) => namedNode("http://www.wikidata.org/prop/direct/" + ln)
const wdtn = (ln) => namedNode("http://www.wikidata.org/prop/direct-normalized/" + ln)
const p = (ln) => namedNode("http://www.wikidata.org/prop/" + ln)
const ps = (ln) => namedNode("http://www.wikidata.org/prop/statement/" + ln)
const psv = (ln) => namedNode("http://www.wikidata.org/prop/statement/value/" + ln)
const psn = (ln) => namedNode("http://www.wikidata.org/prop/statement/value-normalized/" + ln)
const pq = (ln) => namedNode("http://www.wikidata.org/prop/qualifier/" + ln)
const pqv = (ln) => namedNode("http://www.wikidata.org/prop/qualifier/value/" + ln)
const pqn = (ln) => namedNode("http://www.wikidata.org/prop/qualifier/value-normalized/" + ln)
const pr = (ln) => namedNode("http://www.wikidata.org/prop/reference/" + ln)
const prv = (ln) => namedNode("http://www.wikidata.org/prop/reference/value/" + ln)
const prn = (ln) => namedNode("http://www.wikidata.org/prop/reference/value-normalized/" + ln)
const wdno = (ln) => namedNode("http://www.wikidata.org/prop/novalue/" + ln)
const xsd = (ln) => namedNode("http://www.w3.org/2001/XMLSchema#" + ln)

const NS = {
  skos: "http://www.w3.org/2004/02/skos/core#",
  ontolex: "http://www.w3.org/ns/lemon/ontolex#",
  dct: "http://purl.org/dc/terms/",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  wikibase: "http://wikiba.se/ontology#",
  schema: "http://schema.org/",
  cc: "http://creativecommons.org/ns#",
  geo: "http://www.opengis.net/ont/geosparql#",
  prov: "http://www.w3.org/ns/prov#",
  wd: "http://www.wikidata.org/entity/",
  data: "https://www.wikidata.org/wiki/Special:EntityData/",
  s: "http://www.wikidata.org/entity/statement/",
  ref: "http://www.wikidata.org/reference/",
  v: "http://www.wikidata.org/value/",
  wdt: "http://www.wikidata.org/prop/direct/",
  wdtn: "http://www.wikidata.org/prop/direct-normalized/",
  p: "http://www.wikidata.org/prop/",
  ps: "http://www.wikidata.org/prop/statement/",
  psv: "http://www.wikidata.org/prop/statement/value/",
  psn: "http://www.wikidata.org/prop/statement/value-normalized/",
  pq: "http://www.wikidata.org/prop/qualifier/",
  pqv: "http://www.wikidata.org/prop/qualifier/value/",
  pqn: "http://www.wikidata.org/prop/qualifier/value-normalized/",
  pr: "http://www.wikidata.org/prop/reference/",
  prv: "http://www.wikidata.org/prop/reference/value/",
  prn: "http://www.wikidata.org/prop/reference/value-normalized/",
  wdno: "http://www.wikidata.org/prop/novalue/",
  xsd: 'http://www.w3.org/2001/XMLSchema#',
}
const DefaultPrefixes = {
  'xsd': 'http://www.w3.org/2001/XMLSchema#',
  'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
}

const property_type = {
  'commonsMedia': 'http://wikiba.se/ontology#CommonsMedia' ,
  'external-id': 'http://wikiba.se/ontology#ExternalId' ,
  'geo-shape': 'http://wikiba.se/ontology#GeoShape',
  'globe-coordinate': 'http://wikiba.se/ontology#GlobeCoordinate',
  'math': 'http://wikiba.se/ontology#Math',
  'monolingualtext': 'http://wikiba.se/ontology#Monolingualtext',
  'quantity': 'http://wikiba.se/ontology#Quantity',
  'string': 'http://wikiba.se/ontology#String',
  'tabular-data': 'http://wikiba.se/ontology#TabularData',
  'time': 'http://wikiba.se/ontology#Time',
  'edtf': '<http://wikiba.se/ontology#Edtf>',
  'url': 'http://wikiba.se/ontology#Url',
  'wikibase-item': 'http://wikiba.se/ontology#WikibaseItem',
  'wikibase-property': 'http://wikiba.se/ontology#WikibaseProperty'
}

function dumpQuads(graph, prefixes = NS, cutoff = DEFAULT_QUADS_CUTOFF) {
  const usedPrefixes = {};

  // https://www.w3.org/TR/turtle/#grammar-production-ECHAR
  const QuoteEscapes = {
    '\t': '\\t',
    '\b': '\\b',
    '\n': '\\n',
    '\r': '\\r',
    '\f': '\\f',
    '"': '\\"',
    '\'': '\\\'',
    '\\': '\\\\',
  };

  // https://www.w3.org/TR/turtle/#grammar-production-PN_LOCAL_ESC
  // const IriEscapes = '_~.-!$&\'()*+,;=/?#@%'.split('').reduce((acc, ch) => {
  // [_-] permitted in local names
  const IriEscapes = '~.!$&\'()*+,;=/?#@%'.split('').reduce((acc, ch) => {
    acc[ch] = '\\' + ch;
    return acc;
  }, {});

  const quads = Array.isArray(graph) && graph[0] instanceof Store
    ? graph[0].getQuads(graph[1], null, null, null)
    : graph instanceof Store
      ? graph.getQuads(null, null, null, null)
      : graph;
  const trailer = quads.length > cutoff
        ? '\n... plus ' + (quads.length - cutoff) + ' more'
        : '';
  const summary = quads.slice(0, cutoff).map(summarize).join('\n');
  const prefixDecls = Object.keys(usedPrefixes).map(
    p => 'PREFIX ' + p + ': <' + usedPrefixes[p] + '>\n'
  ).join('');
  return quads.length + ' quads:\n' + prefixDecls + summary + trailer;

  function summarize(quad) {
    return `${term(quad.subject)} ${aOrTerm(quad.predicate)} ${term(quad.object)} .`;
  }

  function aOrTerm(termP) {
    return termP.equals(RDF('type'))
      ? 'a'
      : term(termP)
  }
  
  function term(term) {
    const s = term.value;
    return term instanceof BlankNode
      ? ('_:' + s)
      : term instanceof Literal
        ? turtleLiteral(term)
        : shorten(s);
  }
  function turtleLiteral(literal) {
    const valueStr = myEscape(literal.value, QuoteEscapes);
    const langStr = literal.language
      ? '@' + literal.language
      : '';
    const datatypeStr = literal.datatype && literal.datatype.value !== DefaultPrefixes.rdf + 'langString'//.xsd + 'string'
      ? '^^' + shorten(literal.datatype.value)
      : '';
    return '"' + valueStr + '"' + langStr + datatypeStr;
  }

  function shorten(iri) {
    const sorted = Object.entries(prefixes).filter((pair) => iri.startsWith(pair[1])).sort((l, r) => r[1].length - l[1].length);
    if (!sorted.length)
      return '<' + iri + '>';
    const [prefix, namespace] = sorted[0];
    usedPrefixes[prefix] = namespace;
    return prefix + ':' + myEscape(iri.substr(namespace.length), IriEscapes)
  }

  function myEscape(v, escaped) {
    return v.split('').reduce((acc, ch) => acc + (
      (ch in escaped)
        ? escaped[ch]
        : ch
    ), '');
  }
}

console.log(dumpQuads(conv('Q38', JSON.parse(Fs.readFileSync('rome-lite.json', 'utf-8')))))

