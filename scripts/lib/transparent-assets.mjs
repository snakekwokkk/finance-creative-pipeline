import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const TRANSPARENT_ASSET_ENGINE = "native-source-pixel-matting";

export function isRasterAsset(layer) {
  return layer?.editable === "raster"
    && layer?.kind !== "background"
    && layer?.editable !== "background";
}

export function assignAssetIndices(plan, maxAssets = 8) {
  const sourceLayers = Array.isArray(plan?.layers) ? plan.layers : [];
  const rasterLayers = sourceLayers.filter(isRasterAsset);
  if (rasterLayers.length > maxAssets) {
    throw new Error(`ChatGPT 识别出 ${rasterLayers.length} 个复杂透明素材，超过单方向上限 ${maxAssets}`);
  }
  let index = 0;
  const layers = sourceLayers.map((layer) => {
    if (!isRasterAsset(layer)) {
      const { assetIndex: ignored, assetSlot: legacySlot, ...rest } = layer;
      return rest;
    }
    const assigned = { ...layer, assetIndex: index };
    delete assigned.assetSlot;
    index += 1;
    return assigned;
  });
  return {
    ...plan,
    schemaVersion: 4,
    transparentAssets: {
      engine: TRANSPARENT_ASSET_ENGINE,
      assetCount: rasterLayers.length,
      layerIds: layers.filter(isRasterAsset).map((layer) => layer.id)
    },
    layers
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function boxToPixels(box, width, height) {
  const values = Array.isArray(box)
    ? (Number(box[2]) > Number(box[0]) && Number(box[3]) > Number(box[1])
      ? { x: box[0], y: box[1], width: Number(box[2]) - Number(box[0]), height: Number(box[3]) - Number(box[1]) }
      : { x: box[0], y: box[1], width: box[2], height: box[3] })
    : box;
  const normalized = [values?.x, values?.y, values?.width, values?.height]
    .every((value) => Number(value) >= 0 && Number(value) <= 1);
  const x = normalized ? Number(values.x) * width : Number(values?.x || 0);
  const y = normalized ? Number(values.y) * height : Number(values?.y || 0);
  const boxWidth = normalized ? Number(values.width) * width : Number(values?.width || 1);
  const boxHeight = normalized ? Number(values.height) * height : Number(values?.height || 1);
  return {
    left: Math.round(clamp(x, 0, width - 1)),
    top: Math.round(clamp(y, 0, height - 1)),
    width: Math.max(1, Math.round(clamp(boxWidth, 1, width - x))),
    height: Math.max(1, Math.round(clamp(boxHeight, 1, height - y)))
  };
}

async function alphaMetrics(input) {
  const image = sharp(input);
  const metadata = await image.metadata();
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  let foreground = 0;
  let transparent = 0;
  let soft = 0;
  let borderForeground = 0;
  let borderCount = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha > 16) foreground += 1;
      if (alpha < 239) transparent += 1;
      if (alpha > 16 && alpha < 239) soft += 1;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
        borderCount += 1;
        if (alpha > 16) borderForeground += 1;
      }
    }
  }
  return {
    width: info.width,
    height: info.height,
    hasAlpha: Boolean(metadata.hasAlpha),
    foregroundRatio: foreground / pixelCount,
    transparentRatio: transparent / pixelCount,
    softEdgeRatio: soft / pixelCount,
    borderForegroundRatio: borderCount ? borderForeground / borderCount : 1
  };
}

function assetAccepted(metrics, limits) {
  return metrics.hasAlpha
    && metrics.foregroundRatio >= limits.minForegroundRatio
    && metrics.foregroundRatio <= limits.maxForegroundRatio
    && metrics.transparentRatio >= limits.minTransparentRatio
    && metrics.borderForegroundRatio <= limits.maxBorderForegroundRatio;
}

function rejectionReason(metrics, limits) {
  if (!metrics.hasAlpha || metrics.transparentRatio < limits.minTransparentRatio) {
    return "图片没有干净的真实透明 Alpha，可能带有纯色、棋盘格或半透明背景";
  }
  if (metrics.foregroundRatio < limits.minForegroundRatio) return "图片为空或主体过小";
  if (metrics.foregroundRatio > limits.maxForegroundRatio) return "主体占满画布，缺少透明安全边距";
  if (metrics.borderForegroundRatio > limits.maxBorderForegroundRatio) return "主体或背景触碰图片边界";
  return "透明素材未通过质量检查";
}

function safeId(value) {
  return String(value || "asset").replace(/[^a-z0-9_-]+/gi, "-");
}

export function separateAssetFile(outputDir, layer) {
  const filename = `${String(layer.assetIndex + 1).padStart(2, "0")}-${safeId(layer.id)}.png`;
  return path.join(outputDir, filename);
}

function nativeExtractionMode(layer) {
  if (layer.kind === "background" || layer.editable === "background") return "native-background";
  if (layer.kind === "text" || layer.editable === "text") return "native-text";
  if (layer.editable === "vector") return "native-vector";
  return "unsupported";
}

export async function validateSeparateAsset({ candidateFile, layer, outputDir, thresholds = {} }) {
  const limits = {
    minForegroundRatio: thresholds.minForegroundRatio ?? 0.005,
    maxForegroundRatio: thresholds.maxForegroundRatio ?? 0.82,
    minTransparentRatio: thresholds.minTransparentRatio ?? 0.18,
    maxBorderForegroundRatio: thresholds.maxBorderForegroundRatio ?? 0.02
  };
  const metrics = await alphaMetrics(candidateFile);
  if (!assetAccepted(metrics, limits)) {
    return {
      status: "rejected",
      engine: TRANSPARENT_ASSET_ENGINE,
      metrics,
      thresholds: limits,
      reason: rejectionReason(metrics, limits)
    };
  }
  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = separateAssetFile(outputDir, layer);
  const trimmed = await sharp(candidateFile)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
  await fs.writeFile(outputFile, trimmed);
  const metadata = await sharp(trimmed).metadata();
  return {
    status: "accepted",
    engine: TRANSPARENT_ASSET_ENGINE,
    metrics,
    thresholds: limits,
    file: path.resolve(outputFile),
    intrinsicPx: { width: metadata.width, height: metadata.height }
  };
}

function paddedBox(box, imageWidth, imageHeight, paddingRatio = 0.02) {
  const padding = Math.max(4, Math.round(Math.max(box.width, box.height) * paddingRatio));
  const left = Math.max(0, box.left - padding);
  const top = Math.max(0, box.top - padding);
  const right = Math.min(imageWidth, box.left + box.width + padding);
  const bottom = Math.min(imageHeight, box.top + box.height + padding);
  return { left, top, width: right - left, height: bottom - top };
}

function patchMean(data, info, left, top, width, height) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      sums[0] += data[offset];
      sums[1] += data[offset + 1];
      sums[2] += data[offset + 2];
      count += 1;
    }
  }
  return sums.map((sum) => sum / Math.max(1, count));
}

function bilinearCornerColor(corners, xRatio, yRatio) {
  return corners[0].map((topLeft, channel) => {
    const top = topLeft * (1 - xRatio) + corners[1][channel] * xRatio;
    const bottom = corners[2][channel] * (1 - xRatio) + corners[3][channel] * xRatio;
    return top * (1 - yRatio) + bottom * yRatio;
  });
}

async function sourcePixelMatte(sourceImage, candidateFile, cropBox, thresholds) {
  const { data, info } = await sharp(sourceImage)
    .extract(cropBox)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const patch = Math.max(2, Math.round(Math.min(info.width, info.height) * 0.06));
  const corners = [
    patchMean(data, info, 0, 0, patch, patch),
    patchMean(data, info, info.width - patch, 0, patch, patch),
    patchMean(data, info, 0, info.height - patch, patch, patch),
    patchMean(data, info, info.width - patch, info.height - patch, patch, patch)
  ];
  const low = Number(thresholds.nativeColorDistanceLow ?? 9);
  const high = Math.max(low + 1, Number(thresholds.nativeColorDistanceHigh ?? 34));
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let y = 0; y < info.height; y += 1) {
    const yRatio = info.height <= 1 ? 0 : y / (info.height - 1);
    for (let x = 0; x < info.width; x += 1) {
      const xRatio = info.width <= 1 ? 0 : x / (info.width - 1);
      const sourceOffset = (y * info.width + x) * info.channels;
      const outputOffset = (y * info.width + x) * 4;
      const background = bilinearCornerColor(corners, xRatio, yRatio);
      const distance = Math.sqrt((
        (data[sourceOffset] - background[0]) ** 2
        + (data[sourceOffset + 1] - background[1]) ** 2
        + (data[sourceOffset + 2] - background[2]) ** 2
      ) / 3);
      const alpha = Math.round(clamp((distance - low) / (high - low), 0, 1) * 255);
      rgba[outputOffset] = data[sourceOffset];
      rgba[outputOffset + 1] = data[sourceOffset + 1];
      rgba[outputOffset + 2] = data[sourceOffset + 2];
      rgba[outputOffset + 3] = alpha;
    }
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(candidateFile);
}

export async function extractSourcePixelAsset({ sourceImage, layer, outputDir, thresholds = {} }) {
  const metadata = await sharp(sourceImage).metadata();
  if (!metadata.width || !metadata.height) throw new Error("无法读取完整预览图尺寸");
  const declaredBox = boxToPixels(layer.bbox, metadata.width, metadata.height);
  const cropBox = paddedBox(declaredBox, metadata.width, metadata.height, thresholds.nativePaddingRatio ?? 0.02);
  await fs.mkdir(outputDir, { recursive: true });
  const candidateFile = path.join(outputDir, `.candidate-native-${layer.assetIndex + 1}.png`);
  await fs.rm(candidateFile, { force: true });
  await sourcePixelMatte(sourceImage, candidateFile, cropBox, thresholds);
  const result = await validateSeparateAsset({
    candidateFile,
    layer,
    outputDir,
    thresholds: {
      ...thresholds,
      maxBorderForegroundRatio: thresholds.nativeMaxBorderForegroundRatio ?? 0.5
    }
  });
  await fs.rm(candidateFile, { force: true });
  return {
    ...result,
    engine: TRANSPARENT_ASSET_ENGINE,
    sourcePixelExact: result.status === "accepted",
    sourceCropPx: cropBox,
    declaredBboxPx: declaredBox
  };
}

export async function duplicateTransparentAsset(file, acceptedResults = []) {
  if (!file || !Array.isArray(acceptedResults) || !acceptedResults.length) return false;
  let current;
  try {
    current = crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
  } catch {
    return false;
  }
  for (const result of acceptedResults) {
    if (!result?.file || result.file === file) continue;
    try {
      const existing = crypto.createHash("sha256").update(await fs.readFile(result.file)).digest("hex");
      if (existing === current) return true;
    } catch {}
  }
  return false;
}

export async function recoverAcceptedAsset({ layer, outputDir, thresholds = {} }) {
  const file = separateAssetFile(outputDir, layer);
  try {
    if ((await fs.stat(file)).size < 100) return null;
    const metadata = await sharp(file).metadata();
    if (!metadata.hasAlpha || !metadata.width || !metadata.height) return null;
    return {
      status: "accepted",
      engine: TRANSPARENT_ASSET_ENGINE,
      recovered: true,
      sourcePixelExact: true,
      file: path.resolve(file),
      intrinsicPx: { width: metadata.width, height: metadata.height }
    };
  } catch {
    return null;
  }
}

export async function writeDecompositionReport({ plan, sourceImage, outputDir, assetResults }) {
  await fs.mkdir(outputDir, { recursive: true });
  const sourceMetadata = await sharp(sourceImage).metadata();
  const canvasWidth = Number(plan?.canvas?.width || sourceMetadata.width);
  const canvasHeight = Number(plan?.canvas?.height || sourceMetadata.height);
  if (!canvasWidth || !canvasHeight) throw new Error("无法读取完整预览图尺寸");
  const warnings = [];
  const layers = plan.layers.map((layer) => {
    const bboxPx = boxToPixels(layer.bbox, canvasWidth, canvasHeight);
    const record = { ...layer, bboxPx, sourceImage: path.resolve(sourceImage) };
    if (!isRasterAsset(layer)) {
      record.extractionMode = nativeExtractionMode(layer);
      return record;
    }
    const result = assetResults.get(layer.id);
    record.assetBboxPx = bboxPx;
    record.asset = result || {
      status: "rejected",
      engine: TRANSPARENT_ASSET_ENGINE,
      reason: "缺少独立透明素材结果"
    };
    if (record.asset.status !== "accepted") {
      record.extractionMode = "transparent-asset-rejected";
      warnings.push(`${layer.id}: ${record.asset.reason}`);
      return record;
    }
    record.file = record.asset.file;
    record.assetIntrinsicPx = record.asset.intrinsicPx;
    record.assetPlacement = {
      box: bboxPx,
      fit: "contain",
      align: "center",
      preserveAspectRatio: true
    };
    record.extractionMode = "native-source-pixel-asset";
    return record;
  });
  const rejectedCount = layers.filter((layer) => layer.extractionMode === "transparent-asset-rejected").length;
  const report = {
    schemaVersion: 4,
    status: rejectedCount ? "rejected" : "ready",
    sourceImage: path.resolve(sourceImage),
    canvas: { width: canvasWidth, height: canvasHeight },
    transparentAssets: plan.transparentAssets,
    layers,
    editableReadiness: rejectedCount ? "transparent-assets-rejected" : "native-source-assets-ready",
    warnings,
    limitations: [
      "透明素材通过 macOS 原生前景分割直接保留完整预览中的源像素，不允许模型重绘",
      "只有无法用 Figma 基础图形可靠重建的复杂视觉才应生成透明 PNG",
      "同一主视觉中的立体对象应作为一个整体提取，避免拆成多个相互漂移的零件"
    ]
  };
  await fs.writeFile(path.join(outputDir, "decomposition-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function reportAssetsReady(report) {
  if (report?.schemaVersion < 4 || report?.status !== "ready") return false;
  if (report?.transparentAssets?.engine !== TRANSPARENT_ASSET_ENGINE) return false;
  const files = (report.layers || [])
    .filter((layer) => layer.extractionMode === "native-source-pixel-asset")
    .map((layer) => layer.file);
  try {
    await Promise.all(files.map(async (file) => {
      if (!file || (await fs.stat(file)).size < 100) throw new Error("missing asset");
    }));
    return true;
  } catch {
    return false;
  }
}
