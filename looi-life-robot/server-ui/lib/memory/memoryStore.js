import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, "../../memory");
const MAX_MEMORY_TEXT_LENGTH = 2000;

export class MemoryStore {
  constructor({ rootDir = DEFAULT_ROOT_DIR, logger } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.logger = logger;
  }

  async readLongTermMemory() {
    return this.readFileSafe(this.memoryPath("MEMORY.md"));
  }

  async appendLongTermMemory(text, metadata = {}) {
    return this.writeMemory({ type: "long_term", text, metadata });
  }

  async appendDailyMemory(text, metadata = {}) {
    return this.writeMemory({ type: "daily", text, metadata });
  }

  async readPersonalityNotes() {
    return this.readFileSafe(this.memoryPath("personality-notes.md"));
  }

  async appendPersonalityNote(text, metadata = {}) {
    return this.writeMemory({ type: "personality_note", text, metadata });
  }

  async getCompactMemoryContext() {
    const today = new Date().toISOString().slice(0, 10);
    const [longTerm, todayMemory, personalityNotes, learnedPhrases] = await Promise.all([
      this.readLongTermMemory(),
      this.readFileSafe(this.memoryPath("daily", `${today}.md`)),
      this.readPersonalityNotes(),
      this.readLearnedPhrases()
    ]);

    return {
      longTerm: compactMarkdown(longTerm, 8000),
      today: compactMarkdown(todayMemory, 5000),
      personalityNotes: compactMarkdown(personalityNotes, 5000),
      learnedPhrases
    };
  }

  async writeMemory({ type, text, metadata = {} } = {}) {
    const normalizedType = normalizeMemoryType(type);
    const safeText = sanitizeMemoryText(text);

    if (!normalizedType) {
      throw Object.assign(new Error("memory type must be long_term, daily, or personality_note"), {
        statusCode: 400
      });
    }

    if (!safeText) {
      throw Object.assign(new Error("memory text must be 1-2000 characters"), {
        statusCode: 400
      });
    }

    if (looksLikeSecret(safeText)) {
      throw Object.assign(new Error("memory text appears to contain a token, API key, or password"), {
        statusCode: 400
      });
    }

    const timestamp = new Date().toISOString();
    const targetPath = this.pathForType(normalizedType, timestamp);
    const entry = formatMemoryEntry(timestamp, safeText, metadata);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.appendFile(targetPath, entry, "utf8");

    return {
      ok: true,
      type: normalizedType,
      path: this.relativeMemoryPath(targetPath),
      timestamp
    };
  }

  async clearDailyMemory(date = new Date().toISOString().slice(0, 10)) {
    const safeDate = String(date).match(/^\d{4}-\d{2}-\d{2}$/)?.[0];

    if (!safeDate) {
      throw Object.assign(new Error("date must be YYYY-MM-DD"), { statusCode: 400 });
    }

    const dailyPath = this.memoryPath("daily", `${safeDate}.md`);
    await fs.rm(dailyPath, { force: true });
    return {
      ok: true,
      path: this.relativeMemoryPath(dailyPath)
    };
  }

  async getMemoryStats() {
    const today = new Date().toISOString().slice(0, 10);
    const paths = {
      longTerm: this.memoryPath("MEMORY.md"),
      today: this.memoryPath("daily", `${today}.md`),
      personalityNotes: this.memoryPath("personality-notes.md"),
      learnedPhrases: this.memoryPath("learned-phrases.json")
    };
    const stats = {};

    await Promise.all(
      Object.entries(paths).map(async ([key, filePath]) => {
        try {
          const stat = await fs.stat(filePath);
          stats[key] = {
            exists: true,
            bytes: stat.size,
            updatedAt: stat.mtime.toISOString()
          };
        } catch {
          stats[key] = {
            exists: false,
            bytes: 0,
            updatedAt: null
          };
        }
      })
    );

    return {
      rootDir: this.rootDir,
      files: stats
    };
  }

  pathForType(type, timestamp = new Date().toISOString()) {
    if (type === "long_term") {
      return this.memoryPath("MEMORY.md");
    }

    if (type === "personality_note") {
      return this.memoryPath("personality-notes.md");
    }

    const date = timestamp.slice(0, 10);
    return this.memoryPath("daily", `${date}.md`);
  }

  memoryPath(...segments) {
    const target = path.resolve(this.rootDir, ...segments);

    if (!target.startsWith(`${this.rootDir}${path.sep}`) && target !== this.rootDir) {
      throw new Error("invalid memory path");
    }

    return target;
  }

  relativeMemoryPath(targetPath) {
    return path.join("memory", path.relative(this.rootDir, targetPath));
  }

  async readFileSafe(filePath) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return "";
      }

      throw error;
    }
  }

  async readLearnedPhrases() {
    try {
      const raw = await fs.readFile(this.memoryPath("learned-phrases.json"), "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, 200) : [];
    } catch {
      return [];
    }
  }
}

function normalizeMemoryType(type) {
  return ["long_term", "daily", "personality_note"].includes(type) ? type : null;
}

function sanitizeMemoryText(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text.trim().slice(0, MAX_MEMORY_TEXT_LENGTH);
}

function compactMarkdown(text, maxLength) {
  const safeText = typeof text === "string" ? text.trim() : "";

  if (safeText.length <= maxLength) {
    return safeText;
  }

  return safeText.slice(-maxLength).trimStart();
}

function formatMemoryEntry(timestamp, text, metadata = {}) {
  const source = sanitizeMetadataValue(metadata.source ?? "unknown", 80);
  const importance = sanitizeMetadataValue(metadata.importance ?? "medium", 30);
  const safeMetadata = Object.entries(metadata)
    .filter(([key]) => !["source", "importance"].includes(key))
    .slice(0, 8)
    .map(([key, value]) => `- ${sanitizeMetadataValue(key, 40)}: ${sanitizeMetadataValue(value, 160)}`)
    .join("\n");

  return [
    "",
    `## ${timestamp}`,
    `- Source: ${source}`,
    `- Importance: ${importance}`,
    `- Text: ${text}`,
    safeMetadata
  ]
    .filter(Boolean)
    .join("\n")
    .concat("\n");
}

function sanitizeMetadataValue(value, maxLength) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value).slice(0, maxLength);
  }

  return String(value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function looksLikeSecret(text) {
  const value = String(text ?? "").toLowerCase();

  return (
    /\b(api[_ -]?key|token|password|secret|bearer)\b/.test(value) ||
    /\bsk-[a-z0-9_-]{12,}/i.test(String(text ?? "")) ||
    /\b[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,}\b/i.test(String(text ?? ""))
  );
}
