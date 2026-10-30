import { chromium, firefox, webkit } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
const base = process.env.LOOI_PREVIEW_URL ?? "http://localhost:3163",
  out = path.resolve("../../output/web/1.3.0"),
  sizes = [
    [320, 568],
    [360, 640],
    [390, 844],
    [430, 932],
    [667, 375],
    [844, 390],
    [768, 1024],
    [1024, 768],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [2560, 1080],
  ],
  report = {
    startedAt: new Date().toISOString(),
    browsers: [],
    layout: [],
    checks: [],
    models: [],
    failures: [],
  };
await mkdir(path.join(out, "screenshots"), { recursive: true });
process.on("uncaughtException", async (e) => {
  report.failures.push({ kind: "test_runner_error", error: e.message });
  await writeFile(
    path.join(out, "automated-results-partial.json"),
    JSON.stringify(report, null, 2),
  );
  console.error(e);
  process.exit(1);
});
for (const [name, type] of Object.entries(
  process.env.LOOI_MODELS_ONLY ? { chromium } : { chromium, firefox, webkit },
)) {
  const browser = await type.launch(
    name === "chromium"
      ? { channel: "chrome", headless: true }
      : { headless: true },
  );
  report.browsers.push({ name, version: browser.version() });
  const context = await browser.newContext({
    locale: "en-US",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => globalThis.__looiCompanion?.shell);
  for (const [width, height] of process.env.LOOI_MODELS_ONLY ? [] : sizes) {
    await page.setViewportSize({ width, height });
    for (const key of ["robot", "personality", "vision", "settings"]) {
      await page.locator(`.workspace-nav button[data-page=${key}]`).click();
      await page
        .locator(`.workspace-page[data-page=${key}]`)
        .evaluate((e) =>
          e.querySelectorAll("details").forEach((d) => (d.open = true)),
        );
      const result = await page.evaluate(() => {
        const main = document.getElementById("workspaceMain"),
          nav = document.querySelector(".workspace-nav"),
          root = document.getElementById("companionWorkspace"),
          last = [...main.querySelectorAll("button,input,select")]
            .filter((e) => e.getClientRects().length)
            .at(-1);
        last?.scrollIntoView({ block: "end" });
        const r = last?.getBoundingClientRect(),
          m = main.getBoundingClientRect(),
          n = nav.getBoundingClientRect();
        return {
          overflow: main.scrollWidth - main.clientWidth,
          bodyOverflow: document.documentElement.scrollWidth - innerWidth,
          reachable: !r || r.bottom <= m.bottom + 2,
          navOverlaps: r
            ? !(
                r.bottom <= n.top ||
                r.top >= n.bottom ||
                r.right <= n.left ||
                r.left >= n.right
              )
            : false,
          header: root.querySelector("h1").textContent,
        };
      });
      report.layout.push({
        browser: name,
        width,
        height,
        page: key,
        ...result,
      });
      if (
        result.overflow > 2 ||
        result.bodyOverflow > 2 ||
        !result.reachable ||
        result.navOverlaps
      )
        report.failures.push({
          kind: "layout",
          browser: name,
          width,
          height,
          page: key,
          ...result,
        });
      await page.locator("#workspaceMain").evaluate((e) => (e.scrollTop = 0));
      if (
        name === "chromium" &&
        [
          [390, 844],
          [844, 390],
          [1440, 900],
          [320, 568],
        ].some((v) => v[0] === width && v[1] === height)
      )
        await page.screenshot({
          path: path.join(out, "screenshots", `${width}x${height}-${key}.png`),
        });
    }
  }
  // Equivalent CSS viewport contraction at 200% desktop zoom; real mobile keyboards remain manual.
  await page.setViewportSize({ width: 640, height: 360 });
  await page.locator(".workspace-nav button[data-page=settings]").click();
  await page.keyboard.press("Tab");
  report.checks.push({
    browser: name,
    check: "keyboard_focus",
    passed: await page.evaluate(() => document.activeElement !== document.body),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("reduce-motion"),
  );
  report.checks.push({
    browser: name,
    check: "reduced_motion",
    passed: await page
      .locator("html")
      .evaluate((e) => e.classList.contains("reduce-motion")),
  });
  await page.locator(".workspace-nav button[data-page=robot]").click();
  await page.locator("#companionStart").click();
  await page.waitForFunction(() => globalThis.__looiCompanion.active);
  report.checks.push({
    browser: name,
    check: "navigation_hidden_during_companionship",
    passed: !(await page.locator(".workspace-nav").isVisible()),
  });
  await page.waitForTimeout(5200);
  report.checks.push({
    browser: name,
    check: "stop_hidden_with_control_layer",
    passed: !(await page.locator("#companionStop").isVisible()),
  });
  await page.evaluate(() => globalThis.__looiCompanion.shell.showControls());
  await page.locator("#companionStop").click();
  await page.waitForFunction(() => !globalThis.__looiCompanion.active&&!document.body.classList.contains("companion-active"));
  report.checks.push({
    browser: name,
    check: "return_to_previous_page",
    passed: await page.locator(".workspace-page[data-page=robot]").isVisible(),
  });
  if (name === "chromium") {
    let textRequests = 0,
      textProfile;
    await page.route("**/api/local-brain/think", async (route) => {
      textRequests++;
      textProfile = route.request().postDataJSON().context.personality;
      await route.fulfill({
        json: {
          ok: true,
          text: "Synthetic test reply",
          action: null,
          provider: "test",
          model: "fixture",
        },
      });
    });
    await page.locator("#companionStart").click();
    await page.locator("#userInput").fill("Hello LOOI");
    await page.locator("#sendButton").click();
    await page.waitForFunction(() =>
      document
        .getElementById("companionNotice")
        .textContent.includes("Synthetic test reply"),
    );
    report.checks.push({
      browser: name,
      check: "text_mode_saved_personality_and_reply",
      passed: textRequests === 1 && textProfile?.coreTraits?.curiosity === 0.75,
    });
    await page.screenshot({
      path: path.join(out, "screenshots", "companion-640x360.png"),
    });
    await page.locator("#companionStop").click();
  }
  // Remote overlay must not end companionship and cancels a pending manual intent.
  await page
    .getByRole("button", { name: name === "none" ? "" : "Remote", exact: true })
    .first()
    .click()
    .catch(() => {});
  if (await page.locator("#companionRemote").isVisible()) {
    await page.keyboard.press("Escape");
    report.checks.push({
      browser: name,
      check: "remote_escape",
      passed: !(await page.locator("#companionRemote").isVisible()),
    });
  }
  report.checks.push({
    browser: name,
    check: "no_uncaught_page_errors",
    passed: errors.length === 0,
    errors,
  });
  if (errors.length)
    report.failures.push({ browser: name, kind: "pageerrors", errors });
  if (name === "chromium") {
    // Fixed synthetic samples exercise the real sherpa WASM, not a fake recognizer.
    for (const [preset, fixture, expected] of [
      ["chinese", "chinese", true],
      ["english", "english", true],
      ["chinese", "negative-zh", false],
      ["english", "negative-en", false],
    ]) {
      const audio = await readFile(`tests/fixtures/wake/${fixture}.wav`);
      const result = await page.evaluate(
        async ({ preset, bytes }) => {
          const { loadResources } = await import("./js/companion/resources.js");
          const { files } = await loadResources("wake");
          const worker = new Worker("./js/companion/wake-worker.js");
          const wave = new DataView(Uint8Array.from(bytes).buffer);
          let offset = 12;
          while (
            offset + 8 < wave.byteLength &&
            String.fromCharCode(...new Uint8Array(wave.buffer, offset, 4)) !==
              "data"
          )
            offset +=
              8 +
              wave.getUint32(offset + 4, true) +
              (wave.getUint32(offset + 4, true) % 2);
          const count = wave.getUint32(offset + 4, true) / 2;
          const samples = new Float32Array(count + 16000);
          for (let n = 0; n < count; n++)
            samples[n] = wave.getInt16(offset + 8 + n * 2, true) / 32768;
          const hits = [];
          let notify;
          const messages = [];
          worker.onmessage = ({ data }) => {
            if (data.type === "wake") hits.push(true);
            if (notify) {
              const f = notify;
              notify = null;
              f(data);
            } else messages.push(data);
          };
          const next = () =>
            messages.length
              ? Promise.resolve(messages.shift())
              : new Promise((resolve, reject) => {
                  const timer = setTimeout(
                    () => reject(Error("WASM worker timeout")),
                    60000,
                  );
                  notify = (v) => {
                    clearTimeout(timer);
                    resolve(v);
                  };
                });
          worker.postMessage(
            { type: "load", files, preset },
            Object.values(files),
          );
          let ready = await next();
          if (ready.type !== "ready") throw Error(JSON.stringify(ready));
          const started = performance.now();
          for (let n = 0; n < samples.length; n += 1600) {
            const chunk = samples.slice(n, n + 1600);
            worker.postMessage({ type: "pcm", samples: chunk }, [chunk.buffer]);
            let message;
            do {
              message = await next();
              if (message.type === "error") throw Error(message.reason);
            } while (message.type !== "processed");
          }
          worker.terminate();
          return {
            hits: hits.length,
            ms: performance.now() - started,
            audioSeconds: samples.length / 16000,
          };
        },
        { preset, bytes: [...audio] },
      );
      report.models.push({
        kind: "wake",
        fixture,
        expected,
        ...result,
        passed: expected ? result.hits > 0 : result.hits === 0,
      });
      console.log("WASM", fixture, result);
    }
    await page.route("**/test-cat-and-dog.jpg", (route) =>
      route.fulfill({
        body: undefined,
        path: "tests/fixtures/cat_and_dog.jpg",
        contentType: "image/jpeg",
      }),
    );
    const result = await page.evaluate(async () => {
      const { loadResources } = await import("./js/companion/resources.js");
      const { files } = await loadResources("vision");
      const worker = new Worker("./js/companion/vision-worker.js");
      const response = await fetch("./test-cat-and-dog.jpg");
      const frame = await createImageBitmap(await response.blob());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Detector worker timeout")),
          60000,
        );
        worker.onmessage = ({ data }) => {
          if (data.type === "ready")
            worker.postMessage(
              { type: "frame", frame, timestamp: performance.now() },
              [frame],
            );
          else if (data.type === "error") {
            clearTimeout(timer);
            worker.terminate();
            reject(Error(data.reason));
          } else if (data.type === "detections") {
            clearTimeout(timer);
            worker.terminate();
            resolve({
              labels: data.values.map((d) => d.label),
              ms: data.ms,
              boxes: data.values.map((d) => d.box),
            });
          }
        };
        worker.onerror = (e) => reject(Error(e.message));
        worker.postMessage({ type: "load", files }, Object.values(files));
      });
    });
    report.models.push({
      kind: "vision",
      fixture: "cat_and_dog.jpg",
      ...result,
      passed: result.labels.includes("cat") && result.labels.includes("dog"),
    });
    console.log("Vision", result);
    await context.setOffline(true);
    const offline = await page.evaluate(async () => {
      const { loadResources } = await import("./js/companion/resources.js");
      const wake = await loadResources("wake"),
        vision = await loadResources("vision");
      return (
        Object.keys(wake.files).length > 0 &&
        Object.keys(vision.files).length > 0
      );
    });
    report.checks.push({
      browser: name,
      check: "verified_local_models_available_offline",
      passed: offline,
    });
    await context.setOffline(false);
    let uplinks = 0;
    await page.route(
      /\/api\/(gemini-live\/(session|relay)|local-brain\/(think|chat))/,
      async (route) => {
        uplinks++;
        await route.abort();
      },
    );
    await page.evaluate(() => {
      const r = globalThis.__looiCompanion;
      r.getConfig = () => ({ geminiLiveEnabled: true });
      r.config.wake.enabled = true;
      r.capture.start = async () => {};
    });
    await page.locator("#companionStart").click();
    await page.waitForFunction(
      () =>
        globalThis.__looiCompanion.wake.phase === "waiting" &&
        !globalThis.__looiCompanion.shell.start.disabled,
    );
    await page.evaluate(() => {
      const r = globalThis.__looiCompanion;
      for (let n = 0; n < 10; n++) r.onPCM(new Float32Array(1600));
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => globalThis.__looiCompanion.shell.showControls());
    await page.locator("#userInput").fill("stop");
    await page.locator("#sendButton").click();

    report.checks.push({
      browser: name,
      check: "wake_waiting_zero_live_media_or_proactive_uplink",
      passed: uplinks === 0,
      uplinks,
    });
    await page.evaluate(() =>
      globalThis.__looiCompanion.suspend("test_interrupt"),
    );
    report.checks.push({
      browser: name,
      check: "interrupt_requires_explicit_resume",
      passed: await page.evaluate(() => {
        const r = globalThis.__looiCompanion;
        return (
          r.session.phase === "suspended" &&
          r.wake.phase === "paused" &&
          !r.capture.stream &&
          !r.live.getStatus().connected
        );
      }),
    });
    await page.evaluate(() => globalThis.__looiCompanion.shell.showControls());
    await page.locator("#companionStop").click();
  }
  await context.close();
  await browser.close();
  console.log(name, "completed");
}
for (const c of report.checks) if (!c.passed) report.failures.push(c);
for (const m of report.models) if (!m.passed) report.failures.push(m);
report.completedAt = new Date().toISOString();
await writeFile(
  path.join(out, "automated-results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      layouts: report.layout.length,
      checks: report.checks.length,
      models: report.models.length,
      failures: report.failures,
    },
    null,
    2,
  ),
);
if (report.failures.length) process.exitCode = 1;
