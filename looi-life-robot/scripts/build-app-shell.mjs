import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../frontend");
const files = [];
async function visit(dir = "") {
  for (const f of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const p = path.posix.join(dir, f.name);
    if (["vendor", "licenses", "firmware"].includes(p)) continue;
    if (f.isDirectory()) await visit(p);
    else if (
      !["sw.js", "app-shell.json", "runtime-config.js"].includes(p) &&
      !p.endsWith(".map")
    )
      files.push(p);
  }
}
await visit();
const resources = [];
for (const p of files.sort()) {
  const b = await readFile(path.join(root, p));
  resources.push({
    path: p,
    sha256: createHash("sha256").update(b).digest("hex"),
  });
}
const version =
  "1.3.0-" +
  createHash("sha256")
    .update(JSON.stringify(resources))
    .digest("hex")
    .slice(0, 12);
await writeFile(
  path.join(root, "app-shell.json"),
  JSON.stringify({ version, resources }, null, 2) + "\n",
);
console.log(version, resources.length, "shell resources");

const sw = await readFile(path.join(root, "sw.js"), "utf8");
await writeFile(
  path.join(root, "sw.js"),
  sw.replace(/const BUILD\s*=\s*['"][^'"]*['"]/, `const BUILD='${version}'`),
);
