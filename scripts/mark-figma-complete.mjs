import path from "node:path";
import { ensureConfig, localDate } from "./lib/config.mjs";
import { readyDirectionsForFigma } from "./lib/chatgpt-web.mjs";
import { figmaCompletionSummary } from "./lib/figma-sync-state.mjs";
import { readJson, updateRun } from "./lib/state.mjs";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = await ensureConfig();
const date = value("--date") || localDate(config.timezone);
const runDir = path.join(config.outputRoot, date);
const runFile = path.join(runDir, "run.json");
const current = await readJson(runFile);

if (!current) throw new Error(`未找到 ${date} 的 run.json`);
const generationStage = current.stages?.generation;
const hasReadyDirections = Number(current.directionCount || 0) > 0;
if (current.status !== "awaiting_figma" || !["complete", "partial"].includes(generationStage) || !hasReadyDirections) {
  throw new Error("没有可同步的已就绪方向，不能标记 Figma 完成");
}

const manifest = await readJson(path.join(runDir, "figma-manifest.json"));
if (!manifest) throw new Error(`未找到 ${date} 的 figma-manifest.json`);
const readyDirections = await readyDirectionsForFigma(manifest);
const summary = await figmaCompletionSummary({
  runDir,
  date,
  figma: manifest.figma || config.figma,
  readyDirections
});

const next = await updateRun(runFile, {
  status: "complete",
  completedAt: new Date().toISOString(),
  stages: { ...current.stages, figma: "complete" },
  figma: {
    fileKey: (manifest.figma || config.figma).fileKey,
    pageId: (manifest.figma || config.figma).pageId,
    sectionId: summary.section.id,
    sectionName: summary.section.name,
    directionIds: summary.directionIds,
    uploadedAssetCount: summary.uploadedAssetCount,
    syncStateFile: summary.stateFile
  }
});

console.log(JSON.stringify({ status: next.status, runFile, figma: next.figma }));
