import path from "node:path";
import { createFigmaVisualQaReport } from "./lib/figma-visual-qa.mjs";

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const previewFile = value("--preview");
const editableFile = value("--editable");
const geometryFile = value("--geometry");
const outputDir = value("--output");
const direction = Number(value("--direction"));
const type = value("--type");

if (!previewFile || !editableFile || !geometryFile || !outputDir || !Number.isInteger(direction) || !type) {
  throw new Error("用法：node scripts/figma-visual-qa.mjs --direction N --type popup|banner|float --preview preview.png --editable editable.png --geometry geometry.json --output qa-dir");
}

const result = await createFigmaVisualQaReport({
  direction,
  type,
  previewFile: path.resolve(previewFile),
  editableFile: path.resolve(editableFile),
  geometryFile: path.resolve(geometryFile),
  outputDir: path.resolve(outputDir)
});

console.log(JSON.stringify({ reportFile: result.reportFile, report: result.report }, null, 2));
