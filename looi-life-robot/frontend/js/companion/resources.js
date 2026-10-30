import { apiUrl } from "../core/apiBase.js";
const CACHE = "looi-verified-models-v1";
export async function loadResources(
  group,
  { signal, onProgress = () => {} } = {},
) {
  const cache = await caches.open(CACHE);
  const manifestURL = new URL(
    apiUrl("/api/local-models/manifest.json"),
    document.baseURI,
  ).href;
  const manifestKey = manifestURL + "?compatible-app=1.3.0";
  let manifest;
  try {
    const response = await fetch(manifestURL, { cache: "no-store", signal });
    if (!response.ok) throw Error("Resource manifest unavailable");
    manifest = await response.json();
    if (manifest.appVersion !== "1.3.0" || !manifest.resources[group])
      throw Error("Resource version mismatch");
    await cache.put(
      manifestKey,
      new Response(JSON.stringify(manifest), {
        headers: { "content-type": "application/json" },
      }),
    );
  } catch (e) {
    if (signal?.aborted) throw e;
    const cached = await cache.match(manifestKey);
    if (!cached) throw Error("Resource manifest unavailable / 资源清单不可用");
    manifest = await cached.json();
  }
  const result = {};
  const files = manifest.resources[group];
  let loaded = 0,
    total = files.reduce((n, f) => n + f.bytes, 0);
  for (const f of files) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const url = new URL(apiUrl("/api/local-models/" + f.path), document.baseURI)
      .href;
    const key = url + "?sha256=" + f.sha256;
    let r = await cache.match(key);
    let data = r ? await r.arrayBuffer() : null;
    const valid = async (b) => {
      const hash = await crypto.subtle.digest("SHA-256", b);
      return (
        Array.from(new Uint8Array(hash), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join("") === f.sha256
      );
    };
    if (data && !(await valid(data))) {
      await cache.delete(key);
      data = null;
    }
    if (!data) {
      r = await fetch(url, { signal, cache: "no-store" });
      if (!r.ok)
        throw Error("Model download failed / 模型下载失败: " + r.status);
      const chunks = [];
      let size = 0;
      const reader = r.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > f.bytes) throw Error("Resource size mismatch");
          chunks.push(value);
          onProgress((loaded + size) / total);
        }
      } finally {
        reader.releaseLock();
      }
      data = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        data.set(c, offset);
        offset += c.length;
      }
      data = data.buffer;
      if (size !== f.bytes || !(await valid(data)))
        throw Error("Model integrity check failed / 模型校验失败");
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await cache.put(key, new Response(data));
    }
    loaded += f.bytes;
    onProgress(loaded / total);
    result[f.path] = data;
  }
  return { files: result, manifest };
}
export async function clearResourceCache(group) {
  const cache = await caches.open(CACHE);
  for (const key of await cache.keys())
    if (
      group === "vision"
        ? /vision|efficientdet/.test(key.url)
        : /wake/.test(key.url)
    )
      await cache.delete(key);
}
export function blobScript(bytes) {
  return URL.createObjectURL(
    new Blob([bytes], { type: "application/javascript" }),
  );
}
