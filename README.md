


# Streamingo-Mongoose-Elastic

Streamingo-Mongoose-Elastic is a [mongoose](http://mongoosejs.com/) plugin that can automatically index your models into [elasticsearch](https://www.elastic.co/).
It is a wrapper around [elasticsearch](https://www.npmjs.com/package/elasticsearch) to help you work with elasticsearch as a mongoose plugin.

For Github, visit <https://github.com/oxabhishek/streamingo-mongoose-elastic>
Branch `master` is current stable.

For reporting a bug, visit <https://github.com/oxabhishek/streamingo-mongoose-elastic/issues>


- [Installation](#installation)
- [Setup](#setup)
- [Indexing](#indexing)
  - [Saving a document](#saving-a-document)
  - [Removing a docuemnt](#removing-a-document)
  - [Indexing nested models](#indexing-nested-models)
  - [Indexing mongoose references](#indexing-mongoose-references) - [WIP](https://www.investopedia.com/terms/w/workinprogress.asp)
  - [Indexing an existing collection](#indexing-an-existing-collection)
  - [Indexing on demand](#indexing-on-demand)
  - [Unindexing on demand](#unindexing-on-demand)
- [Mapping](#mapping)
  - [Creating mappings on-demand](#creating-mappings-on-demand) - [WIP](https://www.investopedia.com/terms/w/workinprogress.asp)
- [Queries](#queries)

## Installation

The latest version of this package will be as close as possible to the latest `elasticsearch` and `mongoose` packages.

```bash
npm install --save streamingo-mongoose-elastic
```

## Setup

### Model.plugin(smElastic, options)

Options are:

* `index` - the index in Elasticsearch to use. Defaults to the pluralization of the model name.
* `type`  - the type this model represents in Elasticsearch. Defaults to the model name.
* `esClient` - an existing Elasticsearch `Client` instance.
* `hosts` - an array hosts Elasticsearch is running on.
* `host` - the host Elasticsearch is running on
* `indexAutomatically` - allows indexing after model save to be disabled for when you need finer control over when documents are indexed. Defaults to true
* `customProperties` - an object detailing additional properties which will be merged onto the type's default mapping when `createMappings` is called. (This is a work in progress, upcoming in v2.0.0)

To have a model indexed into Elasticsearch simply add the plugin.

```javascript
var mongoose                    = require('mongoose'),
    smElastic = require('streamingo-mongoose-elastic').Plugin, // please note, this is for version 2.x.x onwards; for v1.x.x, the .Plugin was not needed
    Schema                      = mongoose.Schema

var Band = new Schema({
    name: {type: String},
    city: {type: String},
    members: {type: [Artist]}
})

Band.plugin(smElastic)
```

This will by default simply use the pluralization of the model name as the index
while using the model name itself as the type. So if you create a new
Band object and save it, you can see it by navigating to
http://localhost:9200/bands/band/_search (this assumes Elasticsearch is
running locally on port 9200).

The default behavior is all fields get indexed into Elasticsearch. This can be a little wasteful especially considering that
the document is now just being duplicated between mongodb and
Elasticsearch so you should consider opting to index only certain fields by specifying `sme_indexed` on the
fields you want to store:


```javascript
var Band = new Schema({
    name: {type:String, sme_indexed:true},
    city: {type: String},
    members: {type: [Artist]}
})

Band.plugin(smElastic)
```

In this case only the name field will be indexed for searching.

Now, by adding the plugin, the model will have a new method called
`search` which can be used to make simple to complex searches. The `search`
method accepts [standard Elasticsearch query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-queries.html)

```javascript
Band.search({
  query: {
    query_string: {
      query: "axl rose"
    }
  }
}, function(err, results) {
  // results here
});

```

To connect to more than one host, you can use an array of hosts.

```javascript
MyModel.plugin(smElastic, {
  hosts: [
    'localhost:9200',
    'anotherhost:9200'
  ]
})
```

Also, you can re-use an existing Elasticsearch `Client` instance

```javascript
var esClient = new elasticsearch.Client({host: 'localhost:9200'});
MyModel.plugin(streamingo-mongoose-elastic, {
  esClient: esClient
})
```


## Indexing

### Saving a document
The indexing takes place after saving in mongodb and is a deferred process.
One can check the end of the indexation by catching the sme-indexed event.

```javascript
doc.save(function(err){
  if (err) throw err;
  /* Document indexation on going */
});

doc.on('sme-indexed', function(err, res){
  if (err) throw err;
  /* Document is indexed */
});
```
Notice - the doc.on('sme-indexed', ...) needs to be registered outside of save else the trigger will go unnoticed.

### Removing a document
Removing a document, or unindexing, takes place when a document is removed by calling `.remove()` on a mongoose Document instance.
One can check the end of the unindexing by catching the sme-removed event.

```javascript
doc.remove(function(err) {
  if (err) throw err;
  /* Document unindexing in the background */
});

doc.on('sme-removed', function(err, res) {
  if (err) throw err;
  /* Docuemnt is unindexed */
});
```

Note that there exists an option for safe delete. If `is_deleted` field is found in doc and is set to true, it removes the doc from ES as well.

Note that use of `Model.remove` does not involve mongoose documents as outlined in the [documentation](http://mongoosejs.com/docs/api.html#model_Model.remove). Therefore, the following will not unindex the document.

```javascript
MyModel.remove({ _id: doc.id }, function(err) {
  /* doc remains in Elasticsearch cluster */
});
```

### Indexing Nested Models
In order to index nested models you can refer following example.

```javascript
var Artist = new Schema({
    name: String,
    gender: String
})


var Band = new Schema({
    name: {type:String, sme_indexed:true, sme_type: "keyword"},
    city: String,
    artist: {type:[Artist], sme_indexed:true, sme_type: "nested"} // note the sme_type is optional
})

Band.plugin(smElastic)
```

Note: The sme_type is optional for nested, it auto detects if the field is of type Schema.

Note: The sme_type of name field is a `should have` attribute, it allows the mapping of desired type to be defined and created

Note: It maintains the nesting as defined in mongoose in elasticsearch as well.

### Indexing Mongoose References (Work in Progress - Not available as of now)
In order to index mongoose references you can refer following example.

```javascript
var Comment = new Schema({
    title: String
  , body: String
  , author: String
});


var Band = new Schema({
    name: {type:String, sme_indexed:true},
    city: String,
    artists: {type: [Schema.Types.ObjectId], ref: 'Artist', sme_type: 'nested', sme_indexed: true,
     sme_populate: true, sme_select: 'name'}
})
```
In the schema you'll need to set `sme_type:'nested'` and provide `sme_populate` field - setting it to true will populate the artists and then index it to elasticsearch.
By default every field of the referenced schema will be mapped. Use `sme_select` field to pick just specific fields.

`populate` is an array of options objects you normally pass to
[Model.populate](http://mongoosejs.com/docs/api.html#model_Model.populate).

### Indexing An Existing Collection
Already have a mongodb collection that you'd like to index using this
plugin? No problem! Simply call the synchronizeData method on your model to
open a mongoose stream and start indexing documents individually.

```javascript
var InstrumentSchema = new Schema({
  type: String
});
InstrumentSchema.plugin(smElastic);

var Instrument = require('/* path to the mongoose schema */')
  , stream = Instrument.synchronizeData(query, options, callback)
  , count = 0;
```

The `query` param will take in a mongoose query to filter selected documents to be indexed to ES.
The `options` param can take in a list of esIndexedFields as an array that would override the sme_indexed defined in the schema.
The `callback` function would be invoked once the synchronization is complete or throws error.

Synchronizing a subset of documents based on a query as an example -

```javascript
var stream = Instrument.synchronizeData({type: 'Guitar'}, null, function (err, resp) {});
```

### Indexing On Demand
You can do on-demand indexes using the `index` function

```javascript
Movie.findOne({title:'Up in the Air', function(err, movie){
  movie.rating = 6.3;
  movie.index(function(err, res){
    console.log("Movie is indexed!");
  });
});
```

The index method takes 2 arguments:

* `options` (optional) - {index, type} - the index and type to publish to. Defaults to the standard index and type that
  the model was setup with.
* `callback` - callback function to be invoked when document has been
  indexed.

Note that indexing a model does not mean it will be persisted to
mongodb. Use save for that.

### Unindexing on demand
You can remove a document from the Elasticsearch cluster by using the `unIndex` function.

```javascript
doc.unIndex(function(err) {
  console.log("I've been removed from the cluster :(");
});
```

The unIndex method takes 2 arguments:

* `options` (optional) - {index, type} - the index and type to publish to. Defaults to the standard index and type that
  the model was setup with.
* `callback` - callback function to be invoked when model has been
  unindexed.

## Mapping

Schemas can be configured to have special options per field. These match
with the existing [field mapping configurations](https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-types.html) defined by Elasticsearch with the only difference being they are all prefixed by "sme_".

So for example. If you wanted to index a book model and have the boost
for title set to 2.0 (giving it greater priority when searching) you'd
define it as follows:

```javascript
var InstrumentSchema = new Schema({
    type: {type:String, sme_boost:2.0},
    style: {type:String, sme_null_value:"Unknown Style"}
});

```
This example uses a few other mapping fields... such as null_value and
type (which overrides whatever value the schema type is, useful if you
want stronger typing such as float).

There are various mapping options that can be defined in Elasticsearch. Check out [https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html](https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html) for more information. Here are examples to the currently possible definitions in streamingo-mongoose-elastic:

```javascript
var ExampleSchema = new Schema({
  // String (core type)
  string: {type:String, sme_boost:2.0},

  // Number (core type)
  number: {type:Number, sme_type:'integer'},

  // Date (core type)
  date: {type:Date, sme_type:'date'},

  // Array type
  array: {type:Array, sme_type:'keyword'},

  // Object type
  object: {
    field1: {type: String},
    field2: {type: String}
  },

  // Nested type
  nested: [SubSchema],

  // Geo point type
  geo: {
    type: String,
    sme_type: 'geo_point'
  }
});

// Used as nested schema above.
var SubSchema = new Schema({
  field1: {type: String},
  field2: {type: String}
});
```

### Creating Mappings On Demand (Work in Progress - Not available as of now)
Creating the mapping is a **one time operation** and **should be called manualy**.

A InstrumentSchema as an example:

```javascript
var InstrumentSchema = new Schema({
    title: {type:String, sme_boost:2.0}
  , author: {type:String, sme_null_value:"Unknown Author"}
  , publicationDate: {type:Date, sme_type:'date'}

InstrumentSchema.plugin(smElastic);
var Instrument = mongoose.model('Instrument', InstrumentSchema);
Instrument.createMappings({
  "analysis" : {
    "analyzer":{
      "content":{
        "type":"custom",
        "tokenizer":"whitespace"
      }
    }
  }
},function(err, mapping){
  // do neat things here
});

```
This feature is still a work in progress. As of this writing you'll have
to manage whether or not you need to create the mapping, streamingo-mongoose-elastic
will make no assumptions and simply attempt to create the mapping. If
the mapping already exists, an Exception detailing such will be
populated in the `err` argument.


## Queries
The full query DSL of Elasticsearch is exposed through the search
method. For example, if you wanted to find all people between ages 21
and 30:

```javascript
Videos.search({
  {
  	"query": {
  		"bool": {
  			"must": [
  				{
  					"match": {
  						"title": {
  							"query": "mobiltd pho",
  							"fuzziness": 2,
  							"operator": "and"
  						}
  					}
  				}
  			]
  		}
  	},
  	"highlight": {
  		"fields": {
  			"text": {}
  		}
  	}
  }
}, {skip: 10, limit: 50}, function(err, people){
   // all the people who fit the age group are here! Also, notice the pagination using skip and limit
});

```
See the Elasticsearch [Query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html) docs for more information.

You can also specify query options like [sorts](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-request-sort.html#search-request-sort)

```javascript
Videos.search({/* ... */}, {sort: [{{price : {order : "asc", mode : "avg"}}}], function(err, people){
  //sorted results
});
```

And also [aggregations](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations.html):

```javascript
Person.search({/* ... */}, {
  aggs: {
    'names': {
      'terms': {
        'field': 'name'
      }
    }
  }
}, function(err, results){
  // results.aggregations holds the aggregations
});
```

Options for queries must adhere to the [javascript elasticsearch driver specs](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-search).
