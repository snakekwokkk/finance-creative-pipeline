import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(moduleDir, "../..");
export const appSupportDir = path.join(os.homedir(), "Library", "Application Support", "Codex", "finance-creative-pipeline");
export const configPath = path.join(appSupportDir, "config.json");

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
  const raw = JSON.parse(await fs.readFile(configPath, "utf8"));
  raw.chromeExecutable = expandHome(raw.chromeExecutable);
  raw.profileDirectory = expandHome(raw.profileDirectory);
  raw.outputRoot = expandHome(raw.outputRoot);
  return raw;
}

export function localDate(timeZone = "Asia/Shanghai", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function localTime(timeZone = "Asia/Shanghai", date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
