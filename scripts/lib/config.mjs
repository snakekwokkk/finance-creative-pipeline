import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(moduleDir, "../..");
export const appSupportDir = path.join(os.homedir(), "Library", "Application Support", "Codex", "finance-creative-pipeline");
export const configPath = path.join(appSupportDir, "config.json");
export const REFERENCE_AUDIT_BATCH_SIZE = 6;

const REQUIRED_DIRECTION_COUNTS = new Map([
  ["popup", 5],
  ["banner", 3],
  ["float", 2]
]);

function mergeConfig(defaults, local) {
  if (Array.isArray(defaults) || Array.isArray(local)) return local === undefined ? defaults : local;
  if (!defaults || typeof defaults !== "object" || !local || typeof local !== "object") {
    return local === undefined ? defaults : local;
  }
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(local)) {
    merged[key] = key in defaults ? mergeConfig(defaults[key], value) : value;
  }
  return merged;
}

export function migrateConfig(raw, defaults) {
  const migrated = mergeConfig(defaults, raw);
  migrated.collection ||= {};
  migrated.collection.referenceCount = 10;
  migrated.collection.visualReviewBatchSize = REFERENCE_AUDIT_BATCH_SIZE;
  migrated.collection.visualReviewMaxBatchesPerType = 3;
  if (Array.isArray(migrated.collection.searchPlans)) {
    migrated.collection.searchPlans = migrated.collection.searchPlans.map((plan) => ({
      ...plan,
      count: REQUIRED_DIRECTION_COUNTS.get(plan.type) ?? plan.count
    }));
  }
  migrated.generation ||= {};
  migrated.generation.directionCount = 10;
  migrated.generation.directionCooldownMinutes = Number.isFinite(Number(migrated.generation.directionCooldownMinutes))
    ? Number(migrated.generation.directionCooldownMinutes)
    : 5;
  migrated.generation.figmaCompletionPollIntervalSeconds = Number.isFinite(Number(migrated.generation.figmaCompletionPollIntervalSeconds))
    ? Number(migrated.generation.figmaCompletionPollIntervalSeconds)
    : 2;
  migrated.schemaVersion = 7;
  return migrated;
}

export function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export async function ensureConfig() {
  await fs.mkdir(appSupportDir, { recursive: true });
  try {
    await fs.access(configPath);
  } catch {
    const example = await fs.readFile(path.join(pluginRoot, "assets", "config.example.json"), "utf8");
    await fs.writeFile(configPath, example, "utf8");
  }
  return loadConfig();
}

export async function loadConfig() {
  const [rawText, defaultsText] = await Promise.all([
    fs.readFile(configPath, "utf8"),
    fs.readFile(path.join(pluginRoot, "assets", "config.example.json"), "utf8")
  ]);
  const raw = JSON.parse(rawText);
  const migrated = migrateConfig(raw, JSON.parse(defaultsText));
  if (JSON.stringify(migrated) !== JSON.stringify(raw)) {
    await fs.writeFile(configPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  }
  migrated.chromeExecutable = expandHome(migrated.chromeExecutable);
  migrated.profileDirectory = expandHome(migrated.profileDirectory);
  migrated.outputRoot = expandHome(migrated.outputRoot);
  return migrated;
}

export function localDate(timeZone = "Asia/Shanghai", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function localTime(timeZone = "Asia/Shanghai", date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
