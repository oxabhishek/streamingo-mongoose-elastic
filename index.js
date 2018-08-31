(function () {
  "use strict";
  var MongoosePlugin,
    QuerySearchBuilder,
    elasticSearch = require("elasticsearch"),
    client,
    async = require("async"),
    BATCH_SIZE = 100,
    Helper = require("./libs/helper");

  /**
   * @description module root to be exported and used as a mongoose plugin
   * @param schema - mongoose plugin provides schema object by invoking this constructor
   * @param options - mongoose plugin provides options object by invoking this constructor
   * @constructor
   */
  MongoosePlugin = function (schema, options) {
    var ESoptions = {};

    if (typeof options !== "object" || Object.keys(options).length === 0) {
      options = {
        index: schema.options.collection + "s",
        type: schema.options.collection
      }
    }

    if (typeof options.index !== "string" || options.index.length === 0) {
      options.index = schema.options.collection + "s";
    }

    if (typeof options.type !== "string" || options.type.length === 0) {
      options.type = schema.options.collection;
    }

    if (options.indexAutomatically === null || options.indexAutomatically === undefined) {
      options.indexAutomatically = true;
    }

    if (options.esClient) {

      // use the existing ES client
      client = options.esClient;
    } else {

      ESoptions.hosts = Array.isArray(options.hosts) ? options.hosts : undefined;
      if (!ESoptions.hosts) {
        ESoptions.host = options.host || "localhost:9200";
      }

      // instantiate new ES client
      client = new elasticSearch.Client(ESoptions);
    }

    /**
     * @description on invoking this function, syncs mongo data with ES defined by query param
     * @param query - defines what data to be picked up from db to index
     * @param opts
     * @param callback
     */
    schema.statics.synchronizeData = function (query, opts, callback) {
      var that = this,
        esIndexedFields = Helper.getIndexableFields(schema);

      typeof callback === "function" || (callback = function () {});

      if (typeof query !== "object" || Array.isArray(query)) {
        query = {};
      }

      if (opts) {
        if (Array.isArray(opts.esIndexedFields) && opts.esIndexedFields.length > 0) {
          esIndexedFields = opts.esIndexedFields;
        }
      }

      this.count(query, function (err, count) {
        var asyncTasks = [],
          iterations = Math.ceil(count / BATCH_SIZE),
          i,
          j = 0;

        console.log(schema.options.collection + " - total documents to synchronize: " + count);
        console.log(schema.options.collection + " - BATCH_SIZE: " + BATCH_SIZE);

        for (i = 0; i < iterations; i++) {
          asyncTasks.push(function (callback) {
            that
              .find(query)
              .select(esIndexedFields.join(" "))
              .limit(BATCH_SIZE)
              .skip(BATCH_SIZE * j++)
              .exec(function (err, docs) {
                var bulkData = [];

                if (err || !docs) {
                  return callback(true, null);
                }

                docs.forEach(function (doc) {
                  bulkData.push({
                    index: {
                      _index: options.index,
                      _type: options.type,
                      _id: doc._id.toString()
                    }
                  });

                  // skip doc._id from indexing as it is already set as the ES document id
                  doc = doc.toObject();
                  delete doc._id;
                  bulkData.push(doc);

                  if ((bulkData.length / 2) === docs.length) {
                    client.bulk({
                      body: bulkData
                    }, function (err, resp) {
                      return callback (err, resp ? !resp.errors : null);
                    });
                  }
                });
              });
          });
        }

        async.series(asyncTasks, function (err, data) {
          if (err || !data) {
            return callback(true, null);
          }

          return callback(null, true);
        });

      });
    };

    /**
     *
     * @param callback
     */
    schema.statics.createMappings = function (callback) {
      var mappings = {};

      typeof callback === "function" || (callback = function () {});

      this.createNewIndex(function (err, resp) {
        if (err || !resp) {
          return callback(err, resp);
        }

        mappings["properties"] = Helper.getSchemaMappings(schema);

        client.indices.putMapping({
          index: options.index,
          type: options.type,
          body: mappings
        }, function (err, data) {
          return callback(err, data);
        });
      });
    };

    /**
     * @description adds a save post-hook to schema which on save, automatically indexes doc in ES
     */
    if (options.indexAutomatically) {
      schema.post("save", function (doc) {
        var finalDoc = JSON.parse(JSON.stringify(doc)),
          esIndexedFields = Helper.getIndexableFields(schema),
          esIndexedFieldsHash = {},
          that = this,
          field,
          i;

        for (i = 0; i < esIndexedFields.length; i++) {
          esIndexedFieldsHash[esIndexedFields[i]] = true;
        }

        for (field in finalDoc) {
          if (!finalDoc.hasOwnProperty(field)) {
            continue;
          }

          if (!esIndexedFieldsHash[field]) {
            delete finalDoc[field];
          }
        }

        // TODO - take in is_deleted as an option param called safe-delete
        doc.is_deleted = String(doc.is_deleted).toLowerCase() === "true";
        switch (String(doc.is_deleted).toLowerCase()) {

          // this indicates that the doc is requested to be safely deleted
          // in such cases, we delete the ES entry
          // TODO - take in delete or safe delete in ES as an option param
          case "true": {
            client.delete({
              index: options.index,
              type: options.type,
              id: doc._id.toString()
            }, function (err, resp) {
              that.emit("sme-removed", err, resp);
            });
            break;
          }

          // this indicates that the doc is requested to be inserted or updated
          case "false": {
            client.index({
              index: options.index,
              type: options.type,
              id: doc._id.toString(),
              body: finalDoc
            }, function (err, resp) {
              that.emit("sme-indexed", err, resp);
            });
            break;
          }

          default: {
            break;
          }
        }
      });
    }

    /**
     * @description adds a remove post-hook to the schema post removal of doc to automatically
     * remove doc from ES as well
     */
    if (options.indexAutomatically) {
      schema.post("remove", function (doc) {
        var that = this;

        if (!doc) {
          return;
        }

        client.delete({
          index: options.index,
          type: options.type,
          id: doc._id.toString()
        }, function (err, resp) {
          that.emit("sme-removed", err, resp);
        });
      });
    }

    /**
     * @description allows searching within an index where index is the schema model this method
     * is called against
     * @param query
     * @param opts
     * @param callback
     */
    schema.statics.search = function (query, opts, callback) {

      if (typeof opts === "function") {
        callback = opts;
      }

      typeof callback === "function" || (callback = function () {});

      client.search({
        index: options.index, // fixed index defined by the schema plugin options
        body: query,
        from: opts.skip || query.from || undefined,
        size: opts.limit || query.size || undefined,
        sort: opts.sort || query.sort || undefined
      }, function (err, resp) {
        return callback(err, resp);
      });
    };

    schema.methods.index = function (opts, callback) {
      var doc = this,
        esIndexedFields = Helper.getIndexableFields(schema);

      typeof callback === "function" || (callback = function () {});

      if (!doc._id) {
        return callback(true, null);
      }

      if (!opts) {
        opts = {};
      }

      if (Array.isArray(opts.esIndexedFields) && opts.esIndexedFields.length > 0) {
        esIndexedFields = opts.esIndexedFields;
      }

      if (!opts.index) {
        opts.index = options.index;
      }

      if (!opts.type) {
        opts.type = options.type;
      }

      client.index({
        index: opts.index,
        type: opts.type,
        id: doc._id.toString(),
        body: doc
      }, function (err, resp) {
        return callback(err, resp);
      });
    };

    schema.methods.unIndex = function (opts, callback) {
      var doc = this;

      typeof callback === "function" || (callback = function () {});

      if (!doc._id) {
        return callback(true, null);
      }

      if (!opts) {
        opts = {};
      }

      if (!opts.index) {
        opts.index = options.index;
      }

      if (!opts.type) {
        opts.type = options.type;
      }

      client.delete({
        index: opts.index,
        type: opts.type,
        id: doc._id.toString()
      }, function (err, resp) {
        return callback(err, resp);
      });
    };

    schema.statics.createNewIndex = function (indexName, callback) {
      callback = (typeof indexName === "function") ? indexName : callback;

      typeof callback === "function" || (callback = function () {});

      indexName = (typeof indexName === "string" && indexName.length) ? indexName : options.index;

      client.indices.exists({
        index: indexName
      }, function (err, exists) {
        if (err || !exists) {

          // if it does not exist, create it
          return client.indices.create({
            index: indexName
          }, function (err, resp) {
            return callback(err, resp);
          });
        }

        return callback(null, true);
      });
    }

  };

  QuerySearchBuilder = function (options) {
    var ESoptions = {},
      publicMethods = {},
      privateMethods = {};

    if (typeof options !== "object" || Array.isArray(options)) {
      options = {};
    }

    if (options.esClient) {

      // use the existing ES client
      client = options.esClient;
    } else {

      ESoptions.hosts = Array.isArray(options.hosts) ? options.hosts : undefined;
      if (!ESoptions.hosts) {
        ESoptions.host = options.host || "localhost:9200";
      }

      // instantiate new ES client
      client = new elasticSearch.Client(ESoptions);
    }

    /**
     * @description Returns raw elastic search client
     * @public
     */
    publicMethods._getESClient = function () {
      return client;
    };

    return publicMethods;
  };

  module.exports = {
    Plugin: MongoosePlugin,
    QuerySearchBuilder: QuerySearchBuilder
  };
})();
