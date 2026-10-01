const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

(async () => {
  const result = await esbuild.build({
    entryPoints: ["git-entry.js"], bundle: true, minify: true,
    platform: "browser", format: "iife", outfile: "git-bundle.js",
    legalComments: "inline", metafile: true
  });
  const packages = new Map();
  for (const [input, output] of Object.entries(result.metafile.outputs["git-bundle.js"].inputs)) {
    if (!output.bytesInOutput) continue;
    if (!input.includes("node_modules/")) continue;
    let directory = path.dirname(path.resolve(input));
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, "package.json");
      if (fs.existsSync(manifest)) {
        const info = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (info.name) {
          const item = packages.get(info.name) || { info, directory, sources: [] };
          item.sources.push(path.resolve(input));
          packages.set(info.name, item);
          break;
        }
      }
      directory = path.dirname(directory);
    }
  }
  const notices = [];
  for (const [name, { info, directory, sources }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const files = fs.readdirSync(directory).filter((file) => /^(licen[sc]e|copying|notice)([-.]|$)/i.test(file));
    if (!files.length && info.license === "Apache-2.0") {
      notices.push(`===== ${name} ${info.version} =====\nAuthor: ${JSON.stringify(info.author)}\nLicense: Apache-2.0 (declared in package.json)\n` +
        fs.readFileSync("third-party/Apache-2.0.txt", "utf8"));
      continue;
    }
    if (!files.length) {
      const headers = sources.map((file) => fs.readFileSync(file, "utf8")
        .match(/^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)+/)?.[0] || "")
        .filter((header) => /copyright/i.test(header) && /permission|redistribution/i.test(header));
      if (!headers.length) throw new Error(`Missing license notice for bundled dependency ${name}`);
      notices.push(`===== ${name} ${info.version} =====\n` + [...new Set(headers)].join("\n"));
      continue;
    }
    notices.push(`===== ${name} ${info.version} =====\n` + files.map((file) =>
      `${file}\n${fs.readFileSync(path.join(directory, file), "utf8")}`).join("\n"));
  }
  fs.writeFileSync("GIT_THIRD_PARTY_LICENSES.txt", notices.join("\n\n").trimEnd() + "\n");
  console.log(`Built git-bundle.js and license notices for ${packages.size} bundled packages.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
