import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  port = 3164,
  base = `http://localhost:${port}`,
  child = spawn(process.execPath, ["backend/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      LOCAL_BRAIN_PROVIDER: "mock",
      LOCAL_BRAIN_ENABLED: "true",
      GEMINI_LIVE_ENABLED: "false",
    },
    stdio: "ignore",
  });
const results = [];
try {
  let ready = false;
  for (let n = 0; n < 50; n++) {
    try {
      ready = (await fetch(base + "/api/config")).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Validation backend did not start");
  for (const endpoint of ["think", "chat"]) {
    const response = await fetch(base + "/api/local-brain/" + endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Synthetic validation",
        context: {
          personality: { name: "Test", coreTraits: { curiosity: 2 } },
        },
      }),
    });
    results.push({
      check: "invalid_personality_" + endpoint,
      status: response.status,
      passed: response.status === 400,
    });
  }
  results.push({
    check: "backend_survives_invalid_requests",
    passed: (await fetch(base + "/api/config")).ok,
  });
  const manifest = await fetch(base + "/api/local-models/manifest.json", {
    headers: { Origin: "https://preview.invalid" },
  });
  const data = await manifest.json();
  results.push({
    check: "model_manifest_cors_and_version",
    passed:
      manifest.ok &&
      manifest.headers.get("access-control-allow-origin") === "*" &&
      data.appVersion === "1.3.0" &&
      data.resources.wake.length > 0 &&
      data.resources.vision.length > 0,
  });
} catch (e) {
  results.push({ check: "runner", passed: false, error: e.message });
} finally {
  child.kill("SIGTERM");
}
await writeFile(
  path.resolve(root, "../../output/web/1.3.0/api-results.json"),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.passed)) process.exitCode = 1;
