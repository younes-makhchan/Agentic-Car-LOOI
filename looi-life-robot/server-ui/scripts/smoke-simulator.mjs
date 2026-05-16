import assert from "node:assert/strict";
import { SimulatedESP32Client } from "../public/js/robot/simulatedEsp32Client.js";

const messages = [];
const telemetry = [];
const acks = [];

const sim = new SimulatedESP32Client({
  logger: (message, level = "info") => {
    messages.push({ level, message });
  }
});

sim.onTelemetry((payload) => telemetry.push(payload));
sim.onAck((payload) => acks.push(payload));

await sim.connect();
assert.equal(sim.isConnected(), true);

sim.ping();
sim.sendMotion({
  linear: 0.2,
  angular: 0,
  durationMs: 120
});

await wait(180);
sim.stop("smoke_stop");

const latestTelemetry = sim.getLatestTelemetry();
assert.ok(latestTelemetry);
assert.equal(latestTelemetry.simulated, true);
assert.ok(telemetry.length >= 2);
assert.ok(acks.some((ack) => ack.cmd === "motion"));
assert.ok(acks.some((ack) => ack.cmd === "stop"));

sim.disconnect();
assert.equal(sim.isConnected(), false);

console.log(
  JSON.stringify({
    ok: true,
    telemetryCount: telemetry.length,
    ackCount: acks.length,
    logCount: messages.length
  })
);

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
