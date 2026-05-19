export const OBJECT_LABEL_ALIASES = {
  apple: ["apple"],
  banana: ["banana"],
  person: ["person", "me", "human", "user"],
  remote: ["remote", "remote control", "controller", "remote controller"],
  "cell phone": ["phone", "mobile", "cell phone", "smartphone"],
  bottle: ["bottle"],
  cup: ["cup", "mug"],
  book: ["book"],
  laptop: ["laptop", "computer"],
  keyboard: ["keyboard"],
  mouse: ["mouse"]
};

const GENERIC_WORDS = new Set([
  "this",
  "that",
  "the",
  "a",
  "an",
  "it",
  "object",
  "thing",
  "one",
  "target"
]);

export function normalizeObjectLabel(label) {
  return String(label ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalObjectLabel(label) {
  const normalized = normalizeObjectLabel(label);

  if (!normalized) {
    return "";
  }

  for (const [canonical, aliases] of Object.entries(OBJECT_LABEL_ALIASES)) {
    if (canonical === normalized || aliases.map(normalizeObjectLabel).includes(normalized)) {
      return canonical;
    }
  }

  return normalized;
}

export function getObjectAliases(label) {
  const canonical = canonicalObjectLabel(label);
  const aliases = OBJECT_LABEL_ALIASES[canonical] ?? [];
  return [...new Set([canonical, ...aliases].map(normalizeObjectLabel).filter(Boolean))];
}

export function labelsMatch(label, candidate) {
  const aliases = new Set(getObjectAliases(label));
  return aliases.has(canonicalObjectLabel(candidate)) || aliases.has(normalizeObjectLabel(candidate));
}

export function findMentionedObjectLabels(text, knownLabels = []) {
  const normalized = ` ${normalizeObjectLabel(text)} `;

  if (!normalized.trim()) {
    return [];
  }

  const candidates = new Map();

  Object.entries(OBJECT_LABEL_ALIASES).forEach(([canonical, aliases]) => {
    [canonical, ...aliases].forEach((alias) => {
      candidates.set(normalizeObjectLabel(alias), canonical);
    });
  });

  knownLabels.map(canonicalObjectLabel).filter(Boolean).forEach((label) => {
    candidates.set(label, label);
    getObjectAliases(label).forEach((alias) => candidates.set(alias, label));
  });

  const matches = [];
  [...candidates.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([alias, canonical]) => {
      if (!alias || GENERIC_WORDS.has(alias)) {
        return;
      }

      const pattern = new RegExp(`(^|\\s)${escapeRegExp(alias)}($|\\s)`, "i");
      if (pattern.test(normalized) && !matches.includes(canonical)) {
        matches.push(canonical);
      }
    });

  return matches;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
