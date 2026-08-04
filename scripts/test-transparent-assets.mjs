import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ensureConfig } from "./lib/config.mjs";
import { findOrOpenPage, launchPersistentBrowser, screenshotFailure } from "./lib/browser.mjs";
import { decomposePreview } from "./lib/chatgpt-web.mjs";

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const imageFile = value("--image");
if (!imageFile) {
  throw new Error("用法：node scripts/test-transparent-assets.mjs --image /path/to/preview.png [--out /path/to/test-output] [--index 3]");
}

const previewFile = path.resolve(imageFile);
const outputDir = path.resolve(value("--out") || path.join(path.dirname(previewFile), "transparent-assets-test"));
const directionIndex = Number(value("--index") || 1);
const metadata = await sharp(previewFile).metadata();
if (!metadata.width || !metadata.height) throw new Error("无法读取测试预览图尺寸");
await fs.mkdir(outputDir, { recursive: true });

const config = await ensureConfig();
let context;
let page;
try {
  context = await launchPersistentBrowser(config);
  page = await findOrOpenPage(context, "https://chatgpt.com", "https://chatgpt.com/");
  const layers = await decomposePreview(
    page,
    config,
    previewFile,
    outputDir,
    directionIndex,
    metadata.width,
    metadata.height
  );
  console.log(JSON.stringify({
    status: "ready",
    outputDir,
    previewFile,
    layerCount: layers.layers.length,
    assetCount: layers.layers.filter((layer) => layer.editable === "raster").length,
    assetsDir: path.join(outputDir, "layers"),
    report: path.join(outputDir, "layers", "decomposition-report.json")
  }));
} catch (error) {
  if (page) await screenshotFailure(page, path.join(outputDir, "failure.png"));
  throw error;
} finally {
  await context?.close().catch(() => {});
}
