import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(name, fallback) {
  const value = Number(arg(name));
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function boxToPixels(box, width, height) {
  const normalized = [box.x, box.y, box.width, box.height].every((value) => Number(value) >= 0 && Number(value) <= 1);
  const x = normalized ? box.x * width : box.x;
  const y = normalized ? box.y * height : box.y;
  const w = normalized ? box.width * width : box.width;
  const h = normalized ? box.height * height : box.height;
  return {
    left: Math.round(clamp(x, 0, width - 1)),
    top: Math.round(clamp(y, 0, height - 1)),
    width: Math.max(1, Math.round(clamp(w, 1, width - x))),
    height: Math.max(1, Math.round(clamp(h, 1, height - y)))
  };
}

function paddedBox(box, canvasWidth, canvasHeight, ratio, minPixels) {
  const padX = Math.max(minPixels, Math.round(box.width * ratio));
  const padY = Math.max(minPixels, Math.round(box.height * ratio));
  const left = Math.max(0, box.left - padX);
  const top = Math.max(0, box.top - padY);
  const right = Math.min(canvasWidth, box.left + box.width + padX);
  const bottom = Math.min(canvasHeight, box.top + box.height + padY);
  return { left, top, width: right - left, height: bottom - top };
}

async function ensureMattingExecutable() {
  if (process.platform !== "darwin") throw new Error("像素级抠图需要 macOS 14 或更高版本的 Apple Vision");
  const sourceFile = path.join(moduleDir, "matte-foreground.m");
  const source = await fs.readFile(sourceFile);
  const token = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const cacheDir = path.join(os.homedir(), "Library", "Caches", "Codex", "finance-creative-pipeline");
  const moduleCache = path.join(cacheDir, "clang-modules");
  const executable = path.join(cacheDir, `matte-foreground-${token}`);
  await fs.mkdir(moduleCache, { recursive: true });
  try {
    await fs.access(executable, fs.constants.X_OK);
    return executable;
  } catch {
    const temporary = `${executable}.${process.pid}.tmp`;
    await fs.rm(temporary, { force: true });
    try {
      await execFileAsync("xcrun", [
        "clang", "-fobjc-arc", "-fmodules", `-fmodules-cache-path=${moduleCache}`, "-mmacosx-version-min=14.0",
        sourceFile, "-framework", "Foundation", "-framework", "Vision",
        "-framework", "CoreImage", "-framework", "ImageIO", "-o", temporary
      ], { timeout: 120_000 });
      await fs.chmod(temporary, 0o755);
      await fs.rename(temporary, executable);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return executable;
  }
}

async function alphaMetrics(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  let foreground = 0;
  let soft = 0;
  let borderForeground = 0;
  let borderCount = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      const active = alpha > 16;
      if (active) foreground += 1;
      if (alpha > 16 && alpha < 240) soft += 1;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
        borderCount += 1;
        if (active) borderForeground += 1;
      }
    }
  }
  return {
    foregroundRatio: foreground / pixelCount,
    transparentRatio: (pixelCount - foreground) / pixelCount,
    softEdgeRatio: foreground ? soft / foreground : 0,
    borderForegroundRatio: borderCount ? borderForeground / borderCount : 1
  };
}

function hexColor(channels) {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

async function decontaminateEdges(originalFile, matteFile) {
  const original = await sharp(originalFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const matte = await sharp(matteFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (original.info.width !== matte.info.width || original.info.height !== matte.info.height) {
    throw new Error("前景蒙版尺寸与候选区域不一致");
  }
  const pixels = original.info.width * original.info.height;
  const background = [0, 0, 0];
  let backgroundWeight = 0;
  for (let index = 0; index < pixels; index += 1) {
    const alpha = matte.data[index * matte.info.channels + 3];
    if (alpha > 12) continue;
    const weight = 255 - alpha;
    for (let channel = 0; channel < 3; channel += 1) {
      background[channel] += original.data[index * original.info.channels + channel] * weight;
    }
    backgroundWeight += weight;
  }
  if (backgroundWeight < 255 * 16) {
    return { applied: false, reason: "透明背景样本不足" };
  }
  for (let channel = 0; channel < 3; channel += 1) background[channel] /= backgroundWeight;

  const output = Buffer.alloc(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    const sourceOffset = index * original.info.channels;
    const matteOffset = index * matte.info.channels;
    const outputOffset = index * 4;
    let alpha = matte.data[matteOffset + 3];
    if (alpha <= 8) alpha = 0;
    const normalizedAlpha = alpha / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const sourceValue = original.data[sourceOffset + channel];
      output[outputOffset + channel] = alpha === 0
        ? 0
        : Math.round(clamp((sourceValue - background[channel] * (1 - normalizedAlpha)) / normalizedAlpha, 0, 255));
    }
    output[outputOffset + 3] = alpha;
  }
  const temporary = `${matteFile}.${process.pid}.defringe.png`;
  try {
    await sharp(output, {
      raw: { width: original.info.width, height: original.info.height, channels: 4 }
    }).png().toFile(temporary);
    await fs.rename(temporary, matteFile);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { applied: true, strategy: "estimated-background-color", backgroundColor: hexColor(background) };
}

function acceptsMatte(metrics, thresholds) {
  return metrics.foregroundRatio >= thresholds.minForegroundRatio
    && metrics.foregroundRatio <= thresholds.maxForegroundRatio
    && metrics.transparentRatio >= thresholds.minTransparentRatio
    && metrics.borderForegroundRatio <= thresholds.maxBorderForegroundRatio;
}

async function matteLayer({ executable, imageFile, outputDir, outputFile, assetBox, layer, thresholds }) {
  const safeId = String(layer.id).replace(/[^a-z0-9_-]+/gi, "-");
  const inputFile = path.join(outputDir, `.matting-input-${safeId}-${process.pid}.png`);
  try {
    await sharp(imageFile).extract(assetBox).png().toFile(inputFile);
    const { stdout } = await execFileAsync(executable, [inputFile, outputFile], { timeout: 120_000 });
    const engineReport = JSON.parse(stdout.trim().split("\n").pop());
    const edgeDecontamination = await decontaminateEdges(inputFile, outputFile);
    const metrics = await alphaMetrics(outputFile);
    return {
      accepted: acceptsMatte(metrics, thresholds),
      report: { status: "accepted", ...engineReport, edgeDecontamination, ...metrics }
    };
  } catch (error) {
    return {
      accepted: false,
      report: { status: "rejected", engine: "apple-vision-foreground-instance-mask", reason: error.stderr?.trim() || error.message }
    };
  } finally {
    await fs.rm(inputFile, { force: true });
  }
}

const imageFile = arg("--image");
const layersFile = arg("--layers");
const outputDir = arg("--out");
if (!imageFile || !layersFile || !outputDir) {
  throw new Error("用法：node scripts/decompose-image.mjs --image preview.png --layers layers.json --out layers");
}

const paddingRatio = numberArg("--padding-ratio", 0.08);
const thresholds = {
  minForegroundRatio: numberArg("--min-foreground-ratio", 0.005),
  maxForegroundRatio: numberArg("--max-foreground-ratio", 0.98),
  minTransparentRatio: numberArg("--min-transparent-ratio", 0.02),
  maxBorderForegroundRatio: numberArg("--max-border-foreground-ratio", 0.65)
};
const source = sharp(imageFile);
const metadata = await source.metadata();
const width = metadata.width;
const height = metadata.height;
if (!width || !height) throw new Error("无法读取预览图尺寸");
const plan = JSON.parse(await fs.readFile(layersFile, "utf8"));
const layers = Array.isArray(plan.layers) ? plan.layers : [];
await fs.mkdir(outputDir, { recursive: true });

const needsMatting = layers.some((layer) => !(
  layer.kind === "background"
  || layer.editable === "background"
  || layer.kind === "text"
  || layer.editable === "text"
  || layer.editable === "vector"
));
const executable = needsMatting ? await ensureMattingExecutable() : null;
const outputLayers = [];
const warnings = [];

for (const [index, layer] of layers.entries()) {
  if (!layer.id || !layer.role || !layer.bbox) continue;
  const box = boxToPixels(layer.bbox, width, height);
  const record = { ...layer, bboxPx: box, sourceImage: path.resolve(imageFile) };
  if (layer.kind === "background" || layer.editable === "background") {
    record.extractionMode = "visual-base";
    outputLayers.push(record);
    continue;
  }
  if (layer.kind === "text" || layer.editable === "text" || layer.editable === "vector") {
    record.extractionMode = layer.editable === "vector" ? "native-vector" : "native-text";
    outputLayers.push(record);
    continue;
  }

  const assetBox = paddedBox(box, width, height, paddingRatio, 8);
  const filename = `${String(index + 1).padStart(2, "0")}-${String(layer.id).replace(/[^a-z0-9_-]+/gi, "-")}.png`;
  const outputFile = path.join(outputDir, filename);
  const result = await matteLayer({ executable, imageFile, outputDir, outputFile, assetBox, layer, thresholds });
  record.assetBboxPx = assetBox;
  record.matting = result.report;
  if (result.accepted) {
    record.file = outputFile;
    record.extractionMode = "vision-alpha-matting";
  } else {
    await fs.rm(outputFile, { force: true });
    record.extractionMode = "matting-rejected";
    record.matting.status = "rejected";
    if (!record.matting.reason) record.matting.reason = "透明度或边界质量未达到门槛";
    warnings.push(`${layer.id}: 像素级抠图未通过质量门槛，未输出裁切替代物`);
  }
  outputLayers.push(record);
}

const textLayers = outputLayers.filter((layer) => layer.kind === "text" || layer.editable === "text");
const repairRects = textLayers.filter((layer) => layer.repair?.type === "solid" && layer.repair.color).map((layer) => ({
  input: Buffer.from(`<svg width="${width}" height="${height}"><rect x="${layer.bboxPx.left}" y="${layer.bboxPx.top}" width="${layer.bboxPx.width}" height="${layer.bboxPx.height}" rx="${layer.repair.radius || 0}" fill="${layer.repair.color}"/></svg>`),
  blend: "over"
}));
let cleanedBackgroundFile = null;
if (repairRects.length) {
  cleanedBackgroundFile = path.join(outputDir, "background-clean.png");
  await sharp(imageFile).composite(repairRects).png().toFile(cleanedBackgroundFile);
} else if (textLayers.length) {
  warnings.push("文字区域没有安全的背景修复色，保留原预览作为视觉底图");
}

const rejectedCount = outputLayers.filter((layer) => layer.extractionMode === "matting-rejected").length;
const report = {
  schemaVersion: 2,
  sourceImage: path.resolve(imageFile),
  canvas: { width, height },
  matting: {
    engine: "apple-vision-foreground-instance-mask",
    paddingRatio,
    thresholds
  },
  layers: outputLayers,
  cleanedBackgroundFile,
  editableReadiness: rejectedCount ? "visual-base-required" : "matte-overlay-ready",
  warnings,
  limitations: [
    "像素级抠图只提取当前可见像素，无法恢复被其他图层遮挡的内容",
    "背景空洞未做生成式修复；需要完整视觉时必须保留原预览作为 Visual Base",
    "未通过透明度和边界质量门槛的图层不会退回普通裁切"
  ]
};
await fs.writeFile(path.join(outputDir, "decomposition-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputDir,
  layerCount: outputLayers.length,
  mattedCount: outputLayers.filter((layer) => layer.extractionMode === "vision-alpha-matting").length,
  rejectedCount,
  textCount: textLayers.length,
  cleanedBackgroundFile,
  warnings
}));
