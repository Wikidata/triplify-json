'use strict';

const Fs = require('fs')
const N3 = require('n3')
const { Store, Quad, NamedNode, Literal, BlankNode, DataFactory } = N3
const { quad, namedNode, literal, blankNode } = DataFactory
const DEFAULT_QUADS_CUTOFF = 9999 // 20

function conv (qid, json_item) {
  const rdf_item = new Store()

  for (const pid in json_item.claims) {
    // Properties and their derivatives
    rdf_item.add(quad(pname('wd', pid), pname('rdf', 'type'), pname('wikibase', 'Property')))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'directClaim'), pname('wdt', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'claim'), pname('p', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'statementProperty'), pname('ps', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'statementValue'), pname('psv', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'qualifier'), pname('pq', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'qualifierValue'), pname('pqv', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'reference'), pname('pr', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'referenceValue'), pname('prv', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'novalue'), pname('wdno', pid)))
    rdf_item.add(quad(pname('wd', pid), pname('wikibase', 'propertyType'), namedNode(PropertyType[json_item['claims'][pid][0]["mainsnak"]["datatype"]])))

    let preferredSet = json_item['claims'][pid].find(
      c => c["rank"] === 'preferred'
    ) ? 'preferred' : 'normal';

    // Statements
    for (const claim of json_item['claims'][pid]) {
      const statement_uri = pname('s', claim["id"]);

      // rank
      const rankRdfTerm = RankToRdf[claim["rank"]];
      if (!rankRdfTerm)
        throw Error('unknown rank: ' + claim["rank"]);
      rdf_item.add(quad(statement_uri, pname('wikibase', 'rank'), rankRdfTerm))
      const isTruthy = claim["rank"] === preferredSet;

      // values
      if (claim["mainsnak"]["snaktype"] === "novalue") {
        rdf_item.add(quad(statement_uri, pname('rdf', 'type'), pname('wdno', 'pid')))
      } else {
        const object = parseSnak(claim["mainsnak"]);
        rdf_item.add(quad(statement_uri, pname('ps', 'pid'), object))
        if (isTruthy)
          rdf_item.add(quad(pname('wd', qid), pname('wdt', pid), object))
      }

      // wdt (truthy ststements are set when claims are either Preferred rank or when no preferred rank exist
      //      have normal rank. Statements with a deprecated rank are not reified in the truthy subgraph.)

      rdf_item.add(quad(pname('wd', qid), pname('p', pid), statement_uri))
      rdf_item.add(quad(statement_uri, pname('rdf', 'type'), pname('wikibase', 'Statement')))

      if (isTruthy)
        rdf_item.add(quad(statement_uri, pname('rdf', 'type'), pname('wikibase', 'BestRank')))

      // qualifiers
      for (const qualifier in claim["qualifiers"]) {
        for (const qualifier_prop of claim["qualifiers"][qualifier]) {
          const object = parseSnak(qualifier_prop);
          rdf_item.add(quad(statement_uri, pname('pq', 'qualifier'), object))
        }
      }

      // references
      for (let reference of claim["references"]) {
        const reference_uri = pname('ref', reference["hash"])
        rdf_item.add(quad(reference_uri, pname('rdf', 'type'), pname('wikibase', 'Reference')))
        rdf_item.add(quad(statement_uri, pname('prov', 'wasDerivedFrom'), reference_uri))

        for (let ref_prop in reference["snaks"]) {
          for (let ref_prop_statement of reference["snaks"][ref_prop]) {
            const value = parseSnak(ref_prop_statement)
            rdf_item.add(quad(reference_uri, pname('pr', 'ref_prop'), value))
          }
        }
      }
    }

    for (const language in json_item["labels"]) {
      const l = new literal(json_item["labels"][language]["value"], language)
      rdf_item.addQuad(quad(pname('wd', qid), pname('rdfs', 'label'), l))
    }

    for (const language in json_item["descriptions"])
      rdf_item.add(quad(pname('wd', qid), pname('schema', 'description'), literal(json_item["descriptions"][language]["value"], language)))

    for (const language in json_item["aliases"])
      for (const label of json_item["aliases"][language])
        rdf_item.add(quad(pname('wd', qid), pname('skos', 'altLabel'), literal(label.value, language)))
    
  }
  return rdf_item
}

function parseSnak (statement) {
  const value = statement["datavalue"]["value"];
  switch (statement["datatype"]) {
  case 'commonsMedia':
    return namedNode("http://commons.wikimedia.org/wiki/Special:FilePath/"+value.replace(" ", "_"))
  case 'string':
  case 'external-id':
    return literal(value)
  case 'wikibase-item':
    return pname('wd', value["id"])
  case 'monolingualtext':
    return literal(value["text"], value["language"])
  case 'geo-shape':
    return namedNode("http://commons.wikimedia.org/data/main/"+value)
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
    return literal(value["amount"], pname('xsd', 'decimal'))
  case 'url':
    return namedNode(value)
  case 'time':
    return literal(value["time"], pname('xsd', 'dateTime'))
  default:
    throw Error('unknown snak datatype ' + statement["datatype"])
  }
}

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

  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
}

function pname (pre, lname) {
  if (!(pre in NS))
    throw Error('unknown prefix: ' + pre);
  return namedNode(NS[pre] + lname)
}

const PropertyType = {
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
  'wikibase-property': 'http://wikiba.se/ontology#WikibaseProperty',
  'lexeme': 'http://wikiba.se/ontology#WikibaseLexeme',
  'form': 'http://wikiba.se/ontology#WikibaseForm',
  'sense': 'http://wikiba.se/ontology#WikibaseSense',
  'musical-notation': 'http://wikiba.se/ontology#MusicalNotation',
}

const RankToRdf = {
  "normal": pname('wikibase', 'NormalRank'),
  "preferred": pname('wikibase', 'PreferredRank'),
  "deprecated": pname('wikibase', 'DeprecatedRank'),
}

console.log(dumpQuads(conv('Q38', JSON.parse(Fs.readFileSync(process.argv[2], 'utf-8')))))

/* a dumpQuads function I had lying around:
 */
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
    return termP.equals(pname('rdf', 'type'))
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
    const datatypeStr = literal.datatype && literal.datatype.value !== NS.rdf + 'langString'//.xsd + 'string'
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

