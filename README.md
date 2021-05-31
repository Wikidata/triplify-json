# triplify-json
Create RDF triples from Wikidata JSON files.

``` shell
node triplify-json.js examples/rome.json
```

This repository contains both Javascript and Python scripts to transform Wikibase/Wikidata native JSON format to [RDF](https://www.mediawiki.org/wiki/Wikibase/Indexing/RDF_Dump_Format). Although the Wikibase platform also delivers the RDF natively from its own backend, there are use-cases where a an external script reproducing the same RDF can be valuable. 

## Use-cases
### Pre-ingestion EntitySchema Validation
Bots like those maintained in Gene Wiki, fetch a Wikidata item through the Wikidata API as a JSON object, which is then updated in memory. The updated JSON object is then submitted to the Wikidata API. 
Checking for conformance to an applicable EntitySchema is currently only possible post-submission, since the RDF is directly derived from Wikidata content. 
If a bot edit would lead to a inconsistancy in the applicable EntitySchema, this can only be picked up post ingestion, while these edits should be caught before the submission. By transforming the updated JSON object into its RDF equivalent EntitySchema testing can be validated before submission. 

### Subset extraction
The RDF representation of a Wikidata item contains a redundancy, since it contains both the full statements and the "truthy" statements. A subset that contains is not always necessary and being able to separate truthy from full statements lead to smaller subsets. Similarly being able to taylor which part of Wikidata items (ie. Labels/descriptions, statements, and sitelinks) should be extracted can help toward leaner Wikidata subsets. 
