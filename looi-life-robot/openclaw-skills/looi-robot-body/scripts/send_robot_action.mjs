#!/usr/bin/env node

const options = parseArgs(process.argv.slice(2));
const bridgeUrl = normalizeBaseUrl(process.env.ROBOT_BRIDGE_PUBLIC_URL);
const bridgeToken = process.env.ROBOT_BRIDGE_TOKEN;

if (!bridgeUrl) {
  exitWithError("ROBOT_BRIDGE_PUBLIC_URL is required.");
}

if (!bridgeToken && !options.allowNoToken) {
  exitWithError("ROBOT_BRIDGE_TOKEN is required. Use --allow-no-token only for local testing.");
}

try {
  if (options.status) {
    const payload = await requestJson("/api/robot-bridge/runtime/status");
    printJson(payload);
    process.exit(0);
  }

  if (options.getAction) {
    const payload = await requestJson(
      `/api/robot-bridge/actions/${encodeURIComponent(options.getAction)}`
    );
    printJson(payload);
    process.exit(payload.action ? 0 : 1);
  }

  if (options.memory) {
    const payload = await requestJson("/api/robot-bridge/memory/context");
    printJson(payload);
    process.exit(0);
  }

  if (options.writeMemory) {
    const payload = await requestJson("/api/robot-bridge/memory/write", {
      method: "POST",
      body: {
        type: options.memoryType ?? "daily",
        text: options.writeMemory,
        metadata: {
          source: options.source ?? "kimi_claw_cloud",
          importance: options.confidence ?? "medium"
        }
      }
    });
    printJson(payload);
    process.exit(0);
  }

  if (options.learnedPhrases) {
    const payload = await requestJson("/api/robot-bridge/memory/learned-phrases");
    printJson(payload);
    process.exit(0);
  }

  if (options.addLearnedPhrase) {
    const payload = await requestJson("/api/robot-bridge/memory/learned-phrases", {
      method: "POST",
      body: {
        phrase: options.phrase,
        meaning: options.meaning ?? "",
        action: options.learnedAction,
        args: options.argsJson ?? {},
        confidence: options.confidence ?? "medium",
        source: options.source ?? "kimi_claw_cloud"
      }
    });
    printJson(payload);
    process.exit(0);
  }

  if (options.events) {
    const payload = await requestJson("/api/robot-bridge/events/recent");
    printJson(payload);
    process.exit(0);
  }

  if (options.newEvents) {
    const payload = await requestJson("/api/robot-bridge/events/new");
    printJson(payload);
    process.exit(0);
  }

  if (options.claimEvents) {
    const payload = await requestJson("/api/robot-bridge/events/claim", {
      method: "POST",
      body: {
        consumer: options.source ?? "kimi_claw_cloud",
        limit: options.limit ?? 10
      }
    });
    printJson(payload);
    process.exit(0);
  }

  if (options.waitEvent) {
    const timeoutMs = options.timeoutMs ?? 30000;
    const pollMs = options.pollMs ?? 500;
    const types = options.eventTypes ? `&types=${encodeURIComponent(options.eventTypes)}` : "";
    const payload = await requestJson(
      `/api/robot-bridge/events/wait?timeoutMs=${encodeURIComponent(timeoutMs)}&pollMs=${encodeURIComponent(pollMs)}${types}`
    );
    printJson(payload);
    process.exit(payload.done ? 0 : 2);
  }

  if (options.markEventHandled) {
    const payload = await requestJson(
      `/api/robot-bridge/events/${encodeURIComponent(options.markEventHandled)}/handled`,
      {
        method: "POST",
        body: {
          result: {
            handledBy: options.source ?? "kimi_claw_cloud"
          }
        }
      }
    );
    printJson(payload);
    process.exit(0);
  }

  if (options.markEventIgnored) {
    const payload = await requestJson(
      `/api/robot-bridge/events/${encodeURIComponent(options.markEventIgnored)}/ignored`,
      {
        method: "POST",
        body: {
          result: {
            ignoredBy: options.source ?? "kimi_claw_cloud"
          }
        }
      }
    );
    printJson(payload);
    process.exit(0);
  }

  if (!options.type) {
    exitWithError("--type is required unless using --status or --get-action.");
  }

  const created = await requestJson("/api/robot-bridge/actions", {
    method: "POST",
    body: {
      source: options.source ?? "kimi_claw_cloud",
      type: options.type,
      args: options.args ?? {},
      reason: options.reason,
      requestId: options.requestId
    }
  });

  if (!options.wait) {
    printJson(created);
    process.exit(0);
  }

  const timeoutMs = options.timeoutMs ?? 15000;
  const pollMs = options.pollMs ?? 500;
  const waited = await requestJson(
    `/api/robot-bridge/actions/${encodeURIComponent(
      created.action.id
    )}/wait?timeoutMs=${encodeURIComponent(timeoutMs)}&pollMs=${encodeURIComponent(pollMs)}`
  );

  printJson(waited);

  if (waited.timedOut || !waited.done) {
    process.exit(2);
  }

  process.exit(waited.action?.status === "completed" ? 0 : 1);
} catch (error) {
  exitWithError(error.message);
}

async function requestJson(path, { method = "GET", body } = {}) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (bridgeToken) {
    headers.Authorization = `Bearer ${bridgeToken}`;
  }

  const response = await fetch(`${bridgeUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(stripUndefined(body)) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}

function parseArgs(argv) {
  const parsed = {
    source: "kimi_claw_cloud",
    args: {},
    wait: false,
    status: false,
    events: false,
    newEvents: false,
    claimEvents: false,
    waitEvent: false,
    memory: false,
    learnedPhrases: false,
    addLearnedPhrase: false,
    allowNoToken: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--type":
        parsed.type = argv[++index];
        break;
      case "--args":
        parsed.args = parseJsonArg(argv[++index], "--args");
        break;
      case "--args-json":
        parsed.argsJson = parseJsonArg(argv[++index], "--args-json");
        break;
      case "--source":
        parsed.source = argv[++index];
        break;
      case "--reason":
        parsed.reason = argv[++index];
        break;
      case "--request-id":
        parsed.requestId = argv[++index];
        break;
      case "--wait":
        parsed.wait = true;
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInt(argv[++index], "--timeout-ms");
        break;
      case "--poll-ms":
        parsed.pollMs = parsePositiveInt(argv[++index], "--poll-ms");
        break;
      case "--limit":
        parsed.limit = parsePositiveInt(argv[++index], "--limit");
        break;
      case "--status":
        parsed.status = true;
        break;
      case "--memory":
        parsed.memory = true;
        break;
      case "--write-memory":
        parsed.writeMemory = argv[++index];
        break;
      case "--memory-type":
        parsed.memoryType = argv[++index];
        break;
      case "--learned-phrases":
        parsed.learnedPhrases = true;
        break;
      case "--add-learned-phrase":
        parsed.addLearnedPhrase = true;
        break;
      case "--phrase":
        parsed.phrase = argv[++index];
        break;
      case "--meaning":
        parsed.meaning = argv[++index];
        break;
      case "--action":
        parsed.learnedAction = argv[++index];
        break;
      case "--confidence":
        parsed.confidence = argv[++index];
        break;
      case "--get-action":
        parsed.getAction = argv[++index];
        break;
      case "--events":
        parsed.events = true;
        break;
      case "--new-events":
        parsed.newEvents = true;
        break;
      case "--claim-events":
        parsed.claimEvents = true;
        break;
      case "--wait-event":
        parsed.waitEvent = true;
        break;
      case "--event-types":
        parsed.eventTypes = argv[++index];
        break;
      case "--mark-event-handled":
        parsed.markEventHandled = argv[++index];
        break;
      case "--mark-event-ignored":
        parsed.markEventIgnored = argv[++index];
        break;
      case "--allow-no-token":
        parsed.allowNoToken = true;
        break;
      default:
        exitWithError(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function parseJsonArg(value, flag) {
  try {
    const parsed = JSON.parse(value ?? "{}");

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }

    return parsed;
  } catch (error) {
    exitWithError(`${flag} must be a JSON object: ${error.message}`);
  }
}

function parsePositiveInt(value, flag) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    exitWithError(`${flag} must be a positive number.`);
  }

  return Math.floor(numericValue);
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  return value.trim().replace(/\/+$/, "");
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined)
  );
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function exitWithError(message) {
  console.error(message);
  process.exit(1);
}
