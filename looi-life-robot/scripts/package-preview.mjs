import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(root, "../../output/web/1.3.0"),
  preview = path.join(out, "preview");
await mkdir(preview, { recursive: true });
const allowed = (source) =>
  !source
    .split(path.sep)
    .some(
      (part) =>
        part === "node_modules" ||
        part === "__pycache__" ||
        part === "memory" ||
        part.startsWith(".env") ||
        part.endsWith(".log") ||
        part === ".DS_Store",
    );
for (const dir of ["frontend", "backend", "scripts", "tests", "docs"])
  await cp(path.join(root, dir), path.join(preview, dir), {
    recursive: true,
    filter: allowed,
  });
for (const file of [
  "package.json",
  "package-lock.json",
  "README.md",
  "netlify.toml",
])
  await cp(path.join(root, file), path.join(preview, file));
const resources = [];
async function visit(dir = "") {
  for (const f of await readdir(path.join(preview, dir), {
    withFileTypes: true,
  })) {
    const p = path.posix.join(dir, f.name);
    if (f.isDirectory()) await visit(p);
    else {
      const b = await readFile(path.join(preview, p));
      resources.push({
        path: p,
        bytes: b.length,
        sha256: createHash("sha256").update(b).digest("hex"),
      });
    }
  }
}
await visit();
resources.sort((a, b) => a.path.localeCompare(b.path));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await writeFile(
  path.join(out, "SOURCE-MANIFEST.json"),
  JSON.stringify(
    {
      version: "1.3.0",
      sourceCommit: commit,
      createdAt: new Date().toISOString(),
      resources,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(out, "SHA256SUMS"),
  resources.map((f) => `${f.sha256}  preview/${f.path}`).join("\n") + "\n",
);
for (const [src, dst] of [
  ["README.md", "FEATURES.md"],
  ["PHONE-ACCEPTANCE.md", "PHONE-ACCEPTANCE.md"],
  ["CAPABILITIES.md", "CAPABILITIES.md"],
])
  await cp(path.join(root, "docs/web-1.3.0", src), path.join(out, dst));
await cp(
  path.join(root, "frontend/models/default-companion.json"),
  path.join(out, "default-configuration.json"),
);
await cp(
  path.join(root, "backend/local-resources/manifest.json"),
  path.join(out, "MODEL-MANIFEST.json"),
);
await writeFile(
  path.join(out, "START_PREVIEW.sh"),
  '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")/preview"\nif [ ! -d backend/node_modules ]; then npm --prefix backend ci; fi\nPORT="${PORT:-3163}" node backend/server.js\n',
);
await writeFile(
  path.join(out, "README.md"),
  "# Web 1.3.0\n\n本机预览：http://localhost:3163 。独立副本可运行 `bash START_PREVIEW.sh`；如端口已占用，使用 `PORT=3164 bash START_PREVIEW.sh`。\n\n- `FEATURES.md`：功能与部署说明。模型和运行库随后端一起部署，在浏览器本地推理。\n- `automated-results.json`、`regression-results.json`、`pwa-results.json`：自动核验原始结果。\n- `screenshots/`：手机、横屏与桌面布局。\n- `PHONE-ACCEPTANCE.md`、`CAPABILITIES.md`：真实设备待验收项及浏览器限制。\n- `SOURCE-MANIFEST.json`、`SHA256SUMS`、`MODEL-MANIFEST.json`：版本与源码/资源校验。\n- `PUBLISH-STATUS.json`：提交、推送和部署记录。\n\n副本排除了环境文件、凭据、用户数据和依赖安装目录。真实云端对话、车轮和长时间耗电仍需人工测试。\n",
);
console.log(`${resources.length} files packaged; source ${commit}`);
