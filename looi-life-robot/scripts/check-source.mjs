import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
let count = 0;
async function visit(dir) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + f.name;
    if (f.isDirectory()) await visit(p);
    else if (/\.(js|mjs)$/.test(f.name)) {
      execFileSync(process.execPath, ["--check", p]);
      count++;
    }
  }
}
await visit("frontend/js");
await visit("backend/lib");
await visit("scripts");
execFileSync(process.execPath, ["--check", "frontend/sw.js"]);
execFileSync(process.execPath, ["--check", "backend/server.js"]);
console.log(`Syntax checked ${count + 2} modules`);
