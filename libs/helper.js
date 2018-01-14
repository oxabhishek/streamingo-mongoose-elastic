(function () {
  "use strict";
  var Helper = function () {};

  /**
   * @description returns the ES specific type for a mongooseType
   * @param mongooseType
   * @return {*}
   */
  Helper.getESType = function (mongooseType) {
    var esType = "text";

    // if no type is specified, play safe by returning text data-type of ES
    if (typeof mongooseType !== "string" || mongooseType.length === 0) {
      return esType;
    }

    switch (mongooseType.toLowerCase()) {

      case "string": {
        esType = "text";
        break;
      }

      case "number": {
        esType = "float";
        break;
      }

      case "date": {
        esType = "date";
        break;
      }

      case "boolean": {
        esType = "boolean";
        break;
      }

      case "buffer": {
        esType = "binary";
        break;
      }

      case "mixed": {
        esType = "object";
        break;
      }

      case "objectid": {
        esType = "keyword";
        break;
      }

      case "array": {
        esType = "text";
        break;
      }

      default: {
        esType = "text";
        break;
      }
    }

    return esType;
  };

  /**
   * @description returns the list of fields that are set with "sme_indexed:true" option
   * @param schema
   * @return {Array}
   */
  Helper.getIndexableFields = function (schema) {
    var paths = schema.paths,
      path,
      fields = [];

    for (path in paths) {
      if (!paths.hasOwnProperty(path)) {
        continue;
      }

      if (paths[path].options.sme_indexed) {
        fields.push(path);
      }
    }

    return fields;
  };

  /**
   * @description returns the ESMapping style object (https://www.elastic.co/guide/en/elasticsearch/reference/6.0/indices-put-mapping.html)
   * @param schema - schema provided by mongoose on registering schema as a mongoose plugin
   * @return {object}
   */
  Helper.getSchemaMappings = function (schema) {
    var mappings = {}, // needed if there exists at least one such sme_indexed field in schema
      allMappings = {}, // needed if sme_indexed is not specified for any field in schema
      paths = schema.paths,
      path;

    for (path in paths) {
      if (!paths.hasOwnProperty(path)) {
        continue;
      }

      // if path type is set to false, it means path should not exists which otherwise exists by default..
      // ..ignore such paths
      if (paths[path].options && paths[path].options.type === false) {
        continue;
      }

      // load allMappings without worrying about sme_indexed option
      allMappings[path] = {
        type: paths[path].schema ? "nested" :
          (paths[path].options.sme_type || Helper.getESType(paths[path].instance))
      };

      if (paths[path].options.sme_boost) {
        allMappings[path].boost = paths[path].options.sme_boost;
      }

      if (paths[path].options.sme_null_value) {
        allMappings[path].null_value = paths[path].options.sme_null_value;
      }

      if (allMappings[path].type === "nested") {
        allMappings[path]["properties"] = Helper.getSchemaMappings(paths[path].schema);
      }

      // if however sme_indexed is provided, set mappings object
      if (paths[path].options.sme_indexed) {
        mappings[path] = {
          type: paths[path].schema ? "nested" :
            (paths[path].options.sme_type || Helper.getESType(paths[path].instance))
        };

        if (paths[path].options.sme_boost) {
          mappings[path].boost = paths[path].options.sme_boost;
        }

        if (paths[path].options.sme_null_value) {
          mappings[path].null_value = paths[path].options.sme_null_value;
        }

        // if mappings is nested, recurse on the nested schema
        if (mappings[path].type === "nested") {
          mappings[path]["properties"] = Helper.getSchemaMappings(paths[path].schema);
        }
      }
    }

    // finally, return mappings if it has at least 1 mapping, else return allMappings
    return Object.keys(mappings).length ? mappings : allMappings;
  };

  module.exports = Helper;
})();
