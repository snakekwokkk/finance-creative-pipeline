import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const FIGMA_VISUAL_QA_SCHEMA_VERSION = 1;

export const FIGMA_VISUAL_QA_THRESHOLDS = Object.freeze({
  popup: { similarity: 0.95, maxEdgeErrorPx: 4, maxSizeErrorRatio: 0.01, maxTextBaselineErrorPx: 2 },
  banner: { similarity: 0.95, maxEdgeErrorPx: 2, maxSizeErrorRatio: 0.01, maxTextBaselineErrorPx: 2 },
  float: { similarity: 0.95, maxEdgeErrorPx: 2, maxSizeErrorRatio: 0.01, maxTextBaselineErrorPx: 2 }
});

const requiredStructureChecks = [
  "previewHasImage",
  "visualBaseHidden",
  "visualBaseLocked",
  "editableElementsVisible",
  "correctCanvasSize",
  "noArtworkAutoLayout",
  "noGenericPlaceholders",
  "officialIconsOnly"
];

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeType(type) {
  if (!Object.hasOwn(FIGMA_VISUAL_QA_THRESHOLDS, type)) {
    throw new Error(`Figma QA 类型只支持 popup、banner、float：${type}`);
  }
  return type;
}

function boxEdges(box) {
  const values = [box?.x, box?.y, box?.width, box?.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  return { left: x, top: y, right: x + width, bottom: y + height, width, height };
}

export function evaluateGeometryQa(geometry, thresholds) {
  const layers = Array.isArray(geometry?.layers) ? geometry.layers : [];
  if (!layers.length) throw new Error("Figma QA 几何报告必须包含逐层 expected/actual 数据");
  let maxEdgeErrorPx = 0;
  let maxSizeErrorRatio = 0;
  let maxTextBaselineErrorPx = 0;
  const missingLayerIds = [];
  const criticalMissingLayerIds = [];
  const invalidGeometryLayerIds = [];
  const missingTextBaselineLayerIds = [];

  for (const layer of layers) {
    if (!layer?.actual) {
      missingLayerIds.push(layer?.id || "unknown");
      if (layer?.critical !== false) criticalMissingLayerIds.push(layer?.id || "unknown");
      continue;
    }
    const expected = boxEdges(layer.expected);
    const actual = boxEdges(layer.actual);
    if (!expected || !actual || expected.width <= 0 || expected.height <= 0 || actual.width <= 0 || actual.height <= 0) {
      invalidGeometryLayerIds.push(layer?.id || "unknown");
      continue;
    }
    maxEdgeErrorPx = Math.max(
      maxEdgeErrorPx,
      Math.abs(actual.left - expected.left),
      Math.abs(actual.top - expected.top),
      Math.abs(actual.right - expected.right),
      Math.abs(actual.bottom - expected.bottom)
    );
    maxSizeErrorRatio = Math.max(
      maxSizeErrorRatio,
      Math.abs(actual.width - expected.width) / Math.max(1, expected.width),
      Math.abs(actual.height - expected.height) / Math.max(1, expected.height)
    );
    if (layer.kind === "text") {
      const expectedBaseline = Number(layer.expectedBaseline);
      const actualBaseline = Number(layer.actualBaseline);
      if (!Number.isFinite(expectedBaseline) || !Number.isFinite(actualBaseline)) {
        missingTextBaselineLayerIds.push(layer?.id || "unknown");
      } else {
        maxTextBaselineErrorPx = Math.max(maxTextBaselineErrorPx, Math.abs(actualBaseline - expectedBaseline));
      }
    }
  }

  const matchedLayerCount = layers.length - missingLayerIds.length - invalidGeometryLayerIds.length;
  return {
    layerCount: layers.length,
    matchedLayerCount,
    matchedLayerRatio: matchedLayerCount / layers.length,
    maxEdgeErrorPx,
    maxSizeErrorRatio,
    maxTextBaselineErrorPx,
    missingLayerIds,
    criticalMissingLayerIds,
    invalidGeometryLayerIds,
    missingTextBaselineLayerIds,
    pass: missingLayerIds.length === 0
      && invalidGeometryLayerIds.length === 0
      && missingTextBaselineLayerIds.length === 0
      && maxEdgeErrorPx <= thresholds.maxEdgeErrorPx
      && maxSizeErrorRatio <= thresholds.maxSizeErrorRatio
      && maxTextBaselineErrorPx <= thresholds.maxTextBaselineErrorPx
  };
}

function evaluateStructureQa(structure, type) {
  const checks = [...requiredStructureChecks];
  if (type === "popup") checks.push("popupCanvasTransparent");
  const failedChecks = checks.filter((key) => structure?.[key] !== true);
  return { checks: Object.fromEntries(checks.map((key) => [key, structure?.[key] === true])), failedChecks, pass: failedChecks.length === 0 };
}

function evaluateAssetQa(assets = {}) {
  const missingAcceptedLayerIds = assets.missingAcceptedLayerIds || [];
  const criticalMissingLayerIds = assets.criticalMissingLayerIds || [];
  const rejectedVisibleLayerIds = assets.rejectedVisibleLayerIds || [];
  const residualMatteLayerIds = assets.residualMatteLayerIds || [];
  return {
    acceptedExpected: finite(assets.acceptedExpected),
    acceptedVisible: finite(assets.acceptedVisible),
    missingAcceptedLayerIds,
    criticalMissingLayerIds,
    rejectedVisibleLayerIds,
    residualMatteLayerIds,
    pass: finite(assets.acceptedExpected) === finite(assets.acceptedVisible)
      && missingAcceptedLayerIds.length === 0
      && criticalMissingLayerIds.length === 0
      && rejectedVisibleLayerIds.length === 0
      && residualMatteLayerIds.length === 0
  };
}

function averageCornerBackground(data, info) {
  const sample = Math.max(1, Math.min(12, Math.floor(Math.min(info.width, info.height) / 10)));
  const corners = [
    [0, 0],
    [info.width - sample, 0],
    [0, info.height - sample],
    [info.width - sample, info.height - sample]
  ];
  const sums = [0, 0, 0];
  let count = 0;
  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sample; y += 1) {
      for (let x = startX; x < startX + sample; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        sums[0] += data[offset];
        sums[1] += data[offset + 1];
        sums[2] += data[offset + 2];
        count += 1;
      }
    }
  }
  return sums.map((value) => Math.round(value / count));
}

export async function compareFigmaVisuals({ previewFile, editableFile, outputDir }) {
  const [previewInput, editableInput] = await Promise.all([fs.readFile(previewFile), fs.readFile(editableFile)]);
  const [preview, editable] = await Promise.all([
    sharp(previewInput).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(editableInput).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (preview.info.width !== editable.info.width || preview.info.height !== editable.info.height) {
    throw new Error(`Preview 与 Editable 截图尺寸必须完全一致：${preview.info.width}x${preview.info.height} != ${editable.info.width}x${editable.info.height}`);
  }
  const background = averageCornerBackground(preview.data, preview.info);
  const pixelCount = preview.info.width * preview.info.height;
  const overlay = Buffer.alloc(pixelCount * 4);
  const diff = Buffer.alloc(pixelCount * 4);
  let absoluteDifference = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const previewAlpha = preview.data[offset + 3] / 255;
    const editableAlpha = editable.data[offset + 3] / 255;
    let maximumChannelDifference = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const reference = Math.round(preview.data[offset + channel] * previewAlpha + background[channel] * (1 - previewAlpha));
      const actual = Math.round(editable.data[offset + channel] * editableAlpha + background[channel] * (1 - editableAlpha));
      const channelDifference = Math.abs(reference - actual);
      absoluteDifference += channelDifference;
      maximumChannelDifference = Math.max(maximumChannelDifference, channelDifference);
      overlay[offset + channel] = Math.round((reference + actual) / 2);
    }
    overlay[offset + 3] = 255;
    diff[offset] = maximumChannelDifference;
    diff[offset + 1] = Math.max(0, 96 - maximumChannelDifference);
    diff[offset + 2] = Math.max(0, 255 - maximumChannelDifference * 2);
    diff[offset + 3] = 255;
  }

  await fs.mkdir(outputDir, { recursive: true });
  const overlayFile = path.join(outputDir, "overlay-50.png");
  const diffFile = path.join(outputDir, "difference-heatmap.png");
  await Promise.all([
    sharp(overlay, { raw: { width: preview.info.width, height: preview.info.height, channels: 4 } }).png().toFile(overlayFile),
    sharp(diff, { raw: { width: preview.info.width, height: preview.info.height, channels: 4 } }).png().toFile(diffFile)
  ]);
  const [overlayInput, diffInput] = await Promise.all([fs.readFile(overlayFile), fs.readFile(diffFile)]);
  return {
    width: preview.info.width,
    height: preview.info.height,
    similarity: 1 - absoluteDifference / (pixelCount * 3 * 255),
    previewSha256: sha256(previewInput),
    editableSha256: sha256(editableInput),
    previewFile: path.resolve(previewFile),
    editableFile: path.resolve(editableFile),
    overlayFile: path.resolve(overlayFile),
    overlaySha256: sha256(overlayInput),
    diffFile: path.resolve(diffFile),
    diffSha256: sha256(diffInput)
  };
}

export async function createFigmaVisualQaReport({ direction, type, previewFile, editableFile, geometryFile, outputDir }) {
  const normalizedType = normalizeType(type);
  const thresholds = FIGMA_VISUAL_QA_THRESHOLDS[normalizedType];
  const geometryInput = JSON.parse(await fs.readFile(geometryFile, "utf8"));
  const [visual, geometry] = await Promise.all([
    compareFigmaVisuals({ previewFile, editableFile, outputDir }),
    Promise.resolve(evaluateGeometryQa(geometryInput, thresholds))
  ]);
  const structure = evaluateStructureQa(geometryInput.structure, normalizedType);
  const assets = evaluateAssetQa(geometryInput.assets);
  const report = {
    schemaVersion: FIGMA_VISUAL_QA_SCHEMA_VERSION,
    direction: Number(direction),
    type: normalizedType,
    canvas: { width: visual.width, height: visual.height },
    thresholds,
    visual,
    geometry,
    structure,
    assets,
    pass: visual.similarity >= thresholds.similarity && geometry.pass && structure.pass && assets.pass,
    reviewedAt: new Date().toISOString()
  };
  const reportFile = path.join(outputDir, "figma-qa-report.json");
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportFile };
}

export function assertPassingFigmaQaReport(report, direction) {
  if (Number(report?.schemaVersion) !== FIGMA_VISUAL_QA_SCHEMA_VERSION) throw new Error("Figma QA 报告版本无效");
  if (Number(report?.direction) !== Number(direction?.index)) throw new Error("Figma QA 报告方向编号不匹配");
  if (report?.type !== direction?.type) throw new Error("Figma QA 报告方向类型不匹配");
  if (Number(report?.canvas?.width) !== Number(direction?.width) || Number(report?.canvas?.height) !== Number(direction?.height)) {
    throw new Error("Figma QA 报告画布尺寸与方向产物不匹配");
  }
  const thresholds = FIGMA_VISUAL_QA_THRESHOLDS[normalizeType(direction.type)];
  if (finite(report?.visual?.similarity) < thresholds.similarity) throw new Error("Figma 视觉相似度未达到 95%");
  if (finite(report?.geometry?.maxEdgeErrorPx, Infinity) > thresholds.maxEdgeErrorPx) throw new Error("Figma 图层边缘位置误差超出门槛");
  if (finite(report?.geometry?.maxSizeErrorRatio, Infinity) > thresholds.maxSizeErrorRatio) throw new Error("Figma 图层尺寸误差超出 1%");
  if (finite(report?.geometry?.maxTextBaselineErrorPx, Infinity) > thresholds.maxTextBaselineErrorPx) throw new Error("Figma 文字基线误差超出 2px");
  if (!report?.geometry?.pass || !report?.structure?.pass || !report?.assets?.pass || report?.pass !== true) {
    throw new Error("Figma QA 报告包含未通过的几何、结构或素材检查");
  }
  return report;
}

async function assertFileHash(file, expectedHash, label) {
  if (!file || !expectedHash) throw new Error(`Figma QA 报告缺少${label}证据`);
  const input = await fs.readFile(path.resolve(file));
  if (sha256(input) !== expectedHash) throw new Error(`Figma QA ${label}哈希与当前文件不匹配`);
}

export async function loadPassingFigmaQaReport(file, direction) {
  if (!file) throw new Error("必须提供 --qa-report，不能仅凭肉眼截图标记 qa_passed");
  const absolute = path.resolve(file);
  const input = await fs.readFile(absolute);
  const report = assertPassingFigmaQaReport(JSON.parse(input), direction);
  await assertFileHash(direction.previewFile, report.visual?.previewSha256, "Preview");
  await assertFileHash(report.visual?.editableFile, report.visual?.editableSha256, "Editable");
  await assertFileHash(report.visual?.overlayFile, report.visual?.overlaySha256, "50%叠图");
  await assertFileHash(report.visual?.diffFile, report.visual?.diffSha256, "差分热图");
  return { report, file: absolute, sha256: sha256(input) };
}
