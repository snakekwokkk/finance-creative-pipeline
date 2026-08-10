import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(moduleDir, "../..");
export const appSupportDir = path.join(os.homedir(), "Library", "Application Support", "Codex", "finance-creative-pipeline");
export const configPath = path.join(appSupportDir, "config.json");

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
  const schemaVersion = Number(raw?.schemaVersion || 0);
  if (schemaVersion < 2 && Number(raw?.collection?.visualReviewBatchSize) === 3) {
    migrated.collection.visualReviewBatchSize = 5;
  }
  migrated.schemaVersion = 2;
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
