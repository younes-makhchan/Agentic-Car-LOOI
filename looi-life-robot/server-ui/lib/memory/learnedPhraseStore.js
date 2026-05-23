import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, "../../memory");
const MAX_PHRASES = 200;

const SAFE_LEARNED_ACTIONS = new Set([
  "run_scenario"
]);

export class LearnedPhraseStore {
  constructor({ rootDir = DEFAULT_ROOT_DIR, logger } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.logger = logger;
    this.filePath = path.join(this.rootDir, "learned-phrases.json");
  }

  async listPhrases() {
    return this.readAll();
  }

  async addPhrase(entry = {}) {
    const safeEntry = createEntry(entry);
    const phrases = await this.readAll();
    const existingIndex = phrases.findIndex(
      (item) => item.normalizedPhrase === safeEntry.normalizedPhrase
    );

    if (existingIndex >= 0) {
      phrases.splice(existingIndex, 1);
    }

    phrases.unshift(safeEntry);
    await this.writeAll(phrases.slice(0, MAX_PHRASES));
    return safeEntry;
  }

  async removePhrase(id) {
    const phrases = await this.readAll();
    const next = phrases.filter((entry) => entry.id !== id);

    if (next.length === phrases.length) {
      return null;
    }

    await this.writeAll(next);
    return { ok: true, id };
  }

  async recordUse(id) {
    const phrases = await this.readAll();
    const index = phrases.findIndex((entry) => entry.id === id);

    if (index < 0) {
      return null;
    }

    phrases[index] = {
      ...phrases[index],
      lastUsedAt: new Date().toISOString(),
      useCount: Number(phrases[index].useCount || 0) + 1
    };
    await this.writeAll(phrases);
    return phrases[index];
  }

  async readAll() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((entry) => createEntry(entry)).slice(0, MAX_PHRASES) : [];
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async writeAll(entries) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  }
}

function normalizePhrase(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createEntry(entry = {}) {
  const phrase = sanitizeString(entry.phrase, 160);
  const normalizedPhrase = normalizePhrase(entry.normalizedPhrase || phrase);
  const action = sanitizeString(entry.action, 80);
  const confidence = ["low", "medium", "high"].includes(entry.confidence)
    ? entry.confidence
    : "medium";

  if (!phrase || !normalizedPhrase) {
    throw Object.assign(new Error("phrase is required"), { statusCode: 400 });
  }

  if (!SAFE_LEARNED_ACTIONS.has(action)) {
    throw Object.assign(new Error("learned phrase action must be a safe high-level action"), {
      statusCode: 400
    });
  }

  if (!entry.args || typeof entry.args !== "object" || Array.isArray(entry.args)) {
    throw Object.assign(new Error("learned phrase args must be an object"), {
      statusCode: 400
    });
  }

  return {
    id: sanitizeString(entry.id, 120) || `phrase_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    phrase,
    normalizedPhrase,
    meaning: sanitizeString(entry.meaning, 240),
    action,
    args: JSON.parse(JSON.stringify(entry.args)),
    confidence,
    source: sanitizeString(entry.source, 80) || "manual",
    createdAt: sanitizeIso(entry.createdAt) || new Date().toISOString(),
    lastUsedAt: sanitizeIso(entry.lastUsedAt),
    useCount: clampInteger(entry.useCount, 0, 1_000_000, 0)
  };
}

function sanitizeString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeIso(value) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clampInteger(value, min, max, fallback) {
  const numericValue = Math.floor(Number(value));

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}
