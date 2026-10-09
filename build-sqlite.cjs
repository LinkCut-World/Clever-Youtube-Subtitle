"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = __dirname;
const source = path.resolve(path.dirname(require.resolve("sql.js")), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json")));
const destination = path.join(root, "sqlite");
fs.mkdirSync(destination, { recursive: true });
fs.mkdirSync(path.join(root, "third-party"), { recursive: true });
const assets = [];
for (const name of ["sql-wasm.js", "sql-wasm.wasm"]) {
  const bytes = fs.readFileSync(path.join(source, "dist", name));
  fs.writeFileSync(path.join(destination, name), bytes);
  assets.push({ file: name, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
}
fs.copyFileSync(path.join(source, "LICENSE"), path.join(root, "third-party/SQL-js-MIT.txt"));
fs.writeFileSync(path.join(destination, "provenance.json"), JSON.stringify({ package: "sql.js", version: pkg.version,
  source: `https://github.com/sql-js/sql.js/tree/v${pkg.version}`, license: "MIT", assets }, null, 2) + "\n");
console.log(`Copied pinned sql.js ${pkg.version} runtime and license.`);
