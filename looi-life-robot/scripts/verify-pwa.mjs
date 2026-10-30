import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
const root = path.resolve("frontend"),
  out = path.resolve("../../output/web/1.3.0/pwa-results.json");
let version = "1.3.0-test-A";
const originalManifest = JSON.parse(
  await readFile(path.join(root, "app-shell.json")),
);
const types = {
  ".js": "application/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let file = url.pathname;
    if (file === "/pwa-test") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<!doctype html><title>PWA verification</title><h1>PWA verification</h1>",
      );
      return;
    }
    if (file === "/app-shell.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ...originalManifest, version }));
      return;
    }
    if (file === "/api/config") {
      res.setHeader("Content-Type", "application/json");
      res.end("{}");
      return;
    }
    const full = path.resolve(root, "." + file);
    if (!full.startsWith(root + "/")) {
      res.writeHead(404).end();
      return;
    }
    let bytes = await readFile(full);
    if (file === "/sw.js")
      bytes = Buffer.from(
        bytes
          .toString()
          .replace(
            /const BUILD\s*=\s*['"][^'"]*['"]/,
            `const BUILD='${version}'`,
          ),
      );
    res.setHeader(
      "Content-Type",
      types[path.extname(full)] ?? "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-store");
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({ channel: "chrome" }),
  context = await browser.newContext(),
  page = await context.newPage();
const checks = [];
try {
  await page.goto(base + "/pwa-test");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return (
      !!navigator.serviceWorker.controller && r?.active?.state === "activated"
    );
  });
  await page.evaluate(() => {
    window.controllerChanges = 0;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => controllerChanges++,
    );
  });
  version = "1.3.0-test-B";
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  const update = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const until = async (check) => {
      const deadline = Date.now() + 30000;
      while (!(await check())) {
        if (Date.now() > deadline)
          throw Error(
            "PWA state timed out: " +
              registration.active?.state +
              "/" +
              registration.installing?.state +
              "/" +
              registration.waiting?.state,
          );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    await until(
      () =>
        !!registration.waiting && registration.waiting.state === "installed",
    );
    const changesBefore = window.controllerChanges;
    const pending = registration.waiting;
    pending.postMessage({ type: "activate-approved" });
    await until(() => window.controllerChanges > changesBefore);
    await until(
      async () => !(await caches.keys()).includes("looi-shell-1.3.0-test-A"),
    );
    return {
      waited: changesBefore === 0,
      changed: window.controllerChanges === 1,
    };
  });
  checks.push({
    check: "new_worker_waits_for_approval",
    passed: update.waited,
  });
  checks.push({
    check: "approved_worker_activates_and_retires_old_shell",
    passed: update.changed,
  });
  await context.setOffline(true);
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => globalThis.__looiCompanion);
  checks.push({
    check: "cached_interface_and_scene_catalog_boot_offline",
    passed: await page.evaluate(() => __looiCompanion.catalog.length === 17),
  });
} catch (e) {
  checks.push({ check: "runner", passed: false, error: e.message });
} finally {
  await browser.close();
  server.close();
}
await writeFile(out, JSON.stringify(checks, null, 2) + "\n");
console.log(JSON.stringify(checks, null, 2));
if (checks.some((c) => !c.passed)) process.exitCode = 1;
