/* A waiting worker never takes over an active companion session without approval. */
const BUILD='1.3.0-f6eeb936def3';
const PREFIX = "looi-shell-";
const versionCache = PREFIX + BUILD;
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const r = await fetch("./app-shell.json", { cache: "no-store" });
      if (!r.ok) throw Error("Manifest unavailable");
      const manifest = await r.json();
      if (manifest.version !== BUILD) throw Error("Manifest version mismatch");
      const cache = await caches.open(versionCache);
      try {
        for (const file of manifest.resources) {
          const response = await fetch(file.path, { cache: "no-store" });
          if (!response.ok) throw Error("Incomplete app shell");
          const data = await response.arrayBuffer();
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
            (v) => v.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== file.sha256) throw Error("App integrity failed");
          await cache.put(
            file.path,
            new Response(data, { headers: response.headers }),
          );
        }
        await cache.put(
          "./app-shell.json",
          new Response(JSON.stringify(manifest), {
            headers: { "content-type": "application/json" },
          }),
        );
      } catch (e) {
        await caches.delete(versionCache);
        throw e;
      }
      if (self.registration.active)
        for (const client of await self.clients.matchAll({
          includeUncontrolled: true,
        }))
          client.postMessage({ type: "update-ready" });
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "activate-approved") self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (
          (key.startsWith(PREFIX) || key.startsWith("looi-df26-")) &&
          key !== versionCache
        )
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    /\/(vendor|firmware)\//.test(url.pathname) ||
    url.pathname.endsWith("/runtime-config.js") ||
    url.pathname.endsWith("/sw.js")
  )
    return;
  event.respondWith(
    (async () => {
      const cache = versionCache ? await caches.open(versionCache) : null;
      const match = await cache?.match(
        event.request.mode === "navigate" ? "./index.html" : event.request,
        { ignoreSearch: true },
      );
      return match ?? fetch(event.request);
    })(),
  );
});
