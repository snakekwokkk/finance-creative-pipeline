import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

function polygonMask(points, box, canvasWidth, canvasHeight) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const coords = points.map((point) => {
    const rawX = Array.isArray(point) ? point[0] : point?.x;
    const rawY = Array.isArray(point) ? point[1] : point?.y;
    const x = Number(rawX) <= 1 ? Number(rawX) * canvasWidth - box.left : Number(rawX) - box.left;
    const y = Number(rawY) <= 1 ? Number(rawY) * canvasHeight - box.top : Number(rawY) - box.top;
    return `${clamp(x, 0, box.width)},${clamp(y, 0, box.height)}`;
  }).join(" ");
  return Buffer.from(`<svg width="${box.width}" height="${box.height}"><polygon points="${coords}" fill="white"/></svg>`);
}

const imageFile = arg("--image");
const layersFile = arg("--layers");
const outputDir = arg("--out");
if (!imageFile || !layersFile || !outputDir) throw new Error("用法：node scripts/decompose-image.mjs --image preview.png --layers layers.json --out layers");

const source = sharp(imageFile);
const metadata = await source.metadata();
const width = metadata.width;
const height = metadata.height;
if (!width || !height) throw new Error("无法读取预览图尺寸");
const plan = JSON.parse(await fs.readFile(layersFile, "utf8"));
const layers = Array.isArray(plan.layers) ? plan.layers : [];
await fs.mkdir(outputDir, { recursive: true });

const outputLayers = [];
const warnings = [];
for (const [index, layer] of layers.entries()) {
  if (!layer.id || !layer.role || !layer.bbox) continue;
  const box = boxToPixels(layer.bbox, width, height);
  const record = { ...layer, bboxPx: box, sourceImage: path.resolve(imageFile) };
  if (layer.kind === "text" || layer.editable === "text") {
    outputLayers.push(record);
    continue;
  }
  const filename = `${String(index + 1).padStart(2, "0")}-${String(layer.id).replace(/[^a-z0-9_-]+/gi, "-")}.png`;
  const outputFile = path.join(outputDir, filename);
  let crop = sharp(imageFile).extract(box).ensureAlpha();
  const mask = polygonMask(layer.mask?.points, box, width, height);
  if (mask) crop = crop.composite([{ input: mask, blend: "dest-in" }]);
  await crop.png().toFile(outputFile);
  record.file = outputFile;
  record.extractionMode = mask ? "crop-and-polygon-mask" : "crop";
  if (!mask && ["image", "illustration", "icon", "badge", "decoration"].includes(layer.kind)) {
    warnings.push(`${layer.id}: 未提供可靠轮廓，已输出裁切图，可能包含邻近像素`);
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

const report = {
  schemaVersion: 1,
  sourceImage: path.resolve(imageFile),
  canvas: { width, height },
  layers: outputLayers,
  cleanedBackgroundFile,
  warnings,
  limitations: [
    "单张合成图无法恢复被遮挡的原始像素",
    "没有可靠轮廓的复杂素材以裁切图保存，Figma中仍属于栅格层",
    "文字层只有在背景修复安全时才会从视觉底图中清除"
  ]
};
await fs.writeFile(path.join(outputDir, "decomposition-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputDir, layerCount: outputLayers.length, rasterCount: outputLayers.filter((layer) => layer.file).length, textCount: textLayers.length, cleanedBackgroundFile, warnings }));
