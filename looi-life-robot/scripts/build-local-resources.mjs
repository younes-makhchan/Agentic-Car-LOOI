import {
  mkdir,
  access,
  copyFile,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, ".."),
  workspace = path.resolve(root, "../.."),
  android = path.join(workspace, "LOOI-DF26-Android/app/src/main/assets"),
  out = path.join(root, "backend/local-resources");
const wasmBuild =
  process.env.LOOI_KWS_BUILD ??
  path.join(
    workspace,
    "tmp/web-sherpa-src/build-wasm-simd-kws/install/bin/wasm",
  );
await mkdir(path.join(out, "vendor/wake"), { recursive: true });
await mkdir(path.join(out, "vendor/vision"), { recursive: true });
await mkdir(path.join(out, "models/wake"), { recursive: true });
await mkdir(path.join(out, "licenses"), { recursive: true });
const copy = async (from, to) => {
  try {
    await access(from);
    await copyFile(from, path.join(out, to));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await access(path.join(out, to));
  }
};
for (const file of [
  "sherpa-onnx-wasm-kws-main.js",
  "sherpa-onnx-wasm-kws-main.wasm",
])
  await copy(path.join(wasmBuild, file), "vendor/wake/" + file);
const wrapper = await readFile(
  path.join(wasmBuild, "sherpa-onnx-kws.js"),
  "utf8",
).catch(() =>
  readFile(path.join(out, "vendor/wake/sherpa-onnx-kws.js"), "utf8"),
);
await writeFile(
  path.join(out, "vendor/wake/sherpa-onnx-kws.js"),
  wrapper.includes("globalThis.createKws=createKws;")
    ? wrapper
    : wrapper + "\nglobalThis.createKws=createKws;\n",
);
for (const f of (
  await readdir(path.join(android, "wake")).catch(() =>
    readdir(path.join(out, "models/wake")),
  )
).filter((f) => /\.(onnx|txt)$/.test(f)))
  await copy(path.join(android, "wake", f), "models/wake/" + f);
await copy(
  path.join(android, "efficientdet_lite0.tflite"),
  "models/efficientdet_lite0.tflite",
);
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"])
  await copy(
    path.join(root, "node_modules/@mediapipe/tasks-vision/wasm", f),
    "vendor/vision/" + f,
  );
for (const f of [
  "Apache-2.0.txt",
  "MediaPipe-LICENSE.txt",
  "TensorFlow-LICENSE.txt",
  "XNNPACK-LICENSE.txt",
  "cpuinfo-LICENSE.txt",
  "pthreadpool-LICENSE.txt",
  "protobuf-LICENSE.txt",
  "libyuv-LICENSE.txt",
  "sherpa-onnx-LICENSE.txt",
  "onnxruntime-LICENSE.txt",
  "onnxruntime-ThirdPartyNotices.txt",
])
  await copy(path.join(android, "licenses", f), "licenses/" + f);
await copy(
  path.join(root, "node_modules/@mediapipe/tasks-vision/README.md"),
  "licenses/mediapipe-README.md",
);
await copy(
  path.join(workspace, "LOOI-DF26-Android/docs/wake-upstream-model-card.md"),
  "licenses/wake-model-card.md",
);
await build({
  entryPoints: [
    path.join(root, "frontend/js/companion/vision-worker-source.js"),
  ],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: path.join(root, "frontend/js/companion/vision-worker.js"),
  minify: true,
});
const groups = {
  vision: [
    "models/efficientdet_lite0.tflite",
    "vendor/vision/vision_wasm_internal.js",
    "vendor/vision/vision_wasm_internal.wasm",
  ],
  wake: [],
};
for (const dir of ["vendor/wake", "models/wake"])
  for (const f of await readdir(path.join(out, dir)))
    groups.wake.push(dir + "/" + f);
const resources = {};
for (const [group, paths] of Object.entries(groups))
  resources[group] = await Promise.all(
    paths.map(async (p) => {
      const data = await readFile(path.join(out, p));
      return {
        path: p,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      };
    }),
  );
await writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      appVersion: "1.3.0",
      sherpa: "2.0.0",
      onnxruntime: "1.28.2",
      emscripten: "4.0.23",
      mediaPipe: "0.10.32",
      model: "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20 / chunk16 int8",
      licenses: ["Apache-2.0 (sherpa/model/MediaPipe)", "MIT (ONNX Runtime)"],
      resources,
    },
    null,
    2,
  ) + "\n",
);
