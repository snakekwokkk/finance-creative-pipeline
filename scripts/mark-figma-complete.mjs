import path from "node:path";
import { ensureConfig, localDate } from "./lib/config.mjs";
import { readJson, updateRun } from "./lib/state.mjs";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = await ensureConfig();
const date = value("--date") || localDate(config.timezone);
const runFile = path.join(config.outputRoot, date, "run.json");
const current = await readJson(runFile);

if (!current) throw new Error(`未找到 ${date} 的 run.json`);
const generationStage = current.stages?.generation;
const hasReadyDirections = Number(current.directionCount || 0) > 0;
if (current.status !== "awaiting_figma" || !["complete", "partial"].includes(generationStage) || !hasReadyDirections) {
  throw new Error("没有可同步的已就绪方向，不能标记 Figma 完成");
}

const sectionId = value("--section-id");
const sectionName = value("--section-name") || `${date} 自动采集`;
const directionIds = (value("--direction-ids") || "").split(",").map((item) => item.trim()).filter(Boolean);
const uploadedAssetCount = Number(value("--uploaded-assets") || 0);

if (!sectionId) throw new Error("必须提供 --section-id");
if (!Number.isInteger(uploadedAssetCount) || uploadedAssetCount < 0) throw new Error("--uploaded-assets 必须是非负整数");

const next = await updateRun(runFile, {
  status: "complete",
  completedAt: new Date().toISOString(),
  stages: { ...current.stages, figma: "complete" },
  figma: {
    fileKey: config.figma.fileKey,
    pageId: config.figma.pageId,
    sectionId,
    sectionName,
    directionIds,
    uploadedAssetCount
  }
});

console.log(JSON.stringify({ status: next.status, runFile, figma: next.figma }));
