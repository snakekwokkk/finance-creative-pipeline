import fs from "node:fs/promises";
import path from "node:path";

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

export async function updateRun(runFile, patch) {
  const current = await readJson(runFile, {});
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(runFile, next);
  return next;
}

export async function ensureRun(runFile, date, testMode) {
  const existing = await readJson(runFile);
  if (existing) return existing;
  const initial = {
    date, testMode, status: "created",
    stages: { collection: "pending", generation: "pending", decomposition: "pending", figma: "pending" },
    errors: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  await writeJsonAtomic(runFile, initial);
  return initial;
}

export async function appendError(runFile, stage, error) {
  const current = await readJson(runFile, { errors: [] });
  current.errors ||= [];
  current.errors.push({ stage, message: String(error?.message || error), at: new Date().toISOString() });
  current.status = "blocked";
  current.updatedAt = new Date().toISOString();
  await writeJsonAtomic(runFile, current);
}
