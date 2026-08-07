import path from "node:path";
import { ensureConfig, localDate } from "./lib/config.mjs";
import { readyDirectionsForFigma } from "./lib/chatgpt-web.mjs";
import {
  completeFigmaDirection,
  failFigmaDirection,
  reconcileFigmaSyncState,
  recordFigmaDirectionNode,
  recordFigmaSection,
  startFigmaDirection
} from "./lib/figma-sync-state.mjs";
import { readJson } from "./lib/state.mjs";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const action = process.argv[2] || "inspect";
const config = await ensureConfig();
const date = value("--date") || localDate(config.timezone);
const runDir = path.join(config.outputRoot, date);
const manifestFile = path.join(runDir, "figma-manifest.json");
const manifest = await readJson(manifestFile);
if (!manifest) throw new Error(`未找到 ${date} 的 figma-manifest.json`);
const figma = manifest.figma || config.figma;
const readyDirections = await readyDirectionsForFigma(manifest);
const index = Number(value("--direction"));

let state;
if (action === "inspect") {
  state = (await reconcileFigmaSyncState({ runDir, date, figma, readyDirections })).state;
} else if (action === "section") {
  state = await recordFigmaSection({
    runDir,
    date,
    figma,
    sectionId: value("--section-id"),
    sectionName: value("--section-name")
  });
} else if (action === "start") {
  state = await startFigmaDirection({ runDir, date, figma, readyDirections, index });
} else if (action === "node") {
  state = await recordFigmaDirectionNode({
    runDir,
    date,
    figma,
    readyDirections,
    index,
    nodeId: value("--node-id")
  });
} else if (action === "complete") {
  state = await completeFigmaDirection({
    runDir,
    date,
    figma,
    readyDirections,
    index,
    nodeId: value("--node-id"),
    uploadedAssetCount: Number(value("--uploaded-assets") || 0)
  });
} else if (action === "fail") {
  state = await failFigmaDirection({
    runDir,
    date,
    figma,
    readyDirections,
    index,
    message: value("--message")
  });
} else {
  throw new Error("操作只支持 inspect、section、start、node、complete、fail");
}

console.log(JSON.stringify({
  status: "ok",
  action,
  date,
  stateFile: path.join(runDir, "figma-sync-state.json"),
  state
}, null, 2));
