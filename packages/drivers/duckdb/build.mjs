export const duckDbNativePlugin = {
  name: "verified-duckdb-native",
  setup(build) {
    build.onResolve({ filter: /^@duckdb\/node-bindings$/ }, () => ({
      path: "native",
      namespace: "duckdb-native",
    }));
    build.onLoad({ filter: /.*/, namespace: "duckdb-native" }, () => ({
      contents:
        'module.exports = require(require("node:path").join(__dirname,"native","duckdb.node"));',
      loader: "js",
    }));
  },
};
