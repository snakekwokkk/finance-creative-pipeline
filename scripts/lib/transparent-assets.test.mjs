import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  RECONSTRUCTED_ASSET_ENGINE,
  TRANSPARENT_ASSET_ENGINE,
  assignAssetIndices,
  boxToPixels,
  extractReconstructedAsset,
  recoverAcceptedAsset,
  reportAssetsReady,
  validateSeparateAsset,
  writeDecompositionReport
} from "./transparent-assets.mjs";

test("normalized corner bboxes map to source pixels", () => {
  assert.deepEqual(boxToPixels([0.2, 0.1, 0.7, 0.4], 1000, 1200), {
    left: 200,
    top: 120,
    width: 500,
    height: 360
  });
});

test("normalized x-y-width-height bboxes remain supported", () => {
  assert.deepEqual(boxToPixels([0.7, 0.3, 0.2, 0.1], 1000, 1200), {
    left: 700,
    top: 360,
    width: 200,
    height: 120
  });
});

function plan() {
  return assignAssetIndices({
    schemaVersion: 4,
    canvas: { width: 1000, height: 1200 },
    layers: [
      { id: "background", kind: "background", bbox: { x: 0, y: 0, width: 1, height: 1 }, editable: "background" },
      { id: "hero", role: "Visual/Hero", kind: "illustration", bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.3 }, editable: "raster", assetPrompt: "主视觉" },
      { id: "title", role: "Copy/Title", kind: "text", bbox: { x: 0.2, y: 0.6, width: 0.6, height: 0.08 }, editable: "text", text: "标题" }
    ]
  });
}

test("complex raster assets receive deterministic separate indices", () => {
  const assigned = plan();
  assert.equal(assigned.schemaVersion, 4);
  assert.equal(assigned.transparentAssets.engine, TRANSPARENT_ASSET_ENGINE);
  assert.equal(TRANSPARENT_ASSET_ENGINE, "native-source-pixel-matting");
  assert.deepEqual(assigned.transparentAssets.layerIds, ["hero"]);
  assert.equal(assigned.layers.find((layer) => layer.id === "hero").assetIndex, 0);
});

test("a true transparent image is trimmed and accepted as one independent file", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finance-transparent-asset-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceImage = path.join(root, "preview.png");
  const candidateFile = path.join(root, "candidate.png");
  const outputDir = path.join(root, "layers");
  await sharp({ create: { width: 1000, height: 1200, channels: 4, background: { r: 250, g: 240, b: 235, alpha: 1 } } }).png().toFile(sourceImage);
  await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="220" height="180"><rect x="10" y="10" width="200" height="160" rx="30" fill="#ff4433"/></svg>'), left: 140, top: 160 }])
    .png()
    .toFile(candidateFile);
  const assigned = plan();
  const layer = assigned.layers.find((item) => item.id === "hero");
  const result = await validateSeparateAsset({ candidateFile, layer, outputDir });
  assert.equal(result.status, "accepted");
  assert.ok(result.intrinsicPx.width < 500 && result.intrinsicPx.height < 500);
  const recovered = await recoverAcceptedAsset({ layer, outputDir });
  assert.equal(recovered.status, "accepted");
  assert.equal(recovered.file, result.file);
  const report = await writeDecompositionReport({ plan: assigned, sourceImage, outputDir, assetResults: new Map([["hero", result]]) });
  assert.equal(report.status, "ready");
  assert.equal(report.layers.find((item) => item.id === "hero").assetPlacement.fit, "contain");
  assert.equal(report.layers.find((item) => item.id === "hero").extractionMode, "native-source-pixel-asset");
  assert.ok(await reportAssetsReady(report));
});

test("opaque or colored backgrounds are rejected", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finance-opaque-asset-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidateFile = path.join(root, "candidate.png");
  await sharp({ create: { width: 500, height: 500, channels: 3, background: { r: 20, g: 20, b: 20 } } }).png().toFile(candidateFile);
  const layer = plan().layers.find((item) => item.id === "hero");
  const result = await validateSeparateAsset({ candidateFile, layer, outputDir: root });
  assert.equal(result.status, "rejected");
  assert.match(result.reason, /透明 Alpha/);
});

test("tight small assets are retained with warnings instead of being discarded", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finance-tight-asset-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidateFile = path.join(root, "candidate.png");
  await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 90, b: 30, alpha: 0.8 } } })
    .png()
    .toFile(candidateFile);
  const layer = plan().layers.find((item) => item.id === "hero");
  const retained = await validateSeparateAsset({ candidateFile, layer, outputDir: root });
  assert.equal(retained.status, "accepted");
  assert.equal(retained.quality, "tight-crop");
  assert.ok(retained.warnings.some((warning) => warning.includes("紧裁小素材保留")));
  const rejected = await validateSeparateAsset({
    candidateFile,
    layer,
    outputDir: root,
    thresholds: { allowTightCrop: false }
  });
  assert.equal(rejected.status, "rejected");
});

test("a partially extracted direction remains usable when at least one raster exists", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finance-partial-assets-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceImage = path.join(root, "preview.png");
  const outputDir = path.join(root, "layers");
  const acceptedFile = path.join(outputDir, "01-hero.png");
  await fs.mkdir(outputDir, { recursive: true });
  await sharp({ create: { width: 100, height: 100, channels: 4, background: "#ffffff" } }).png().toFile(sourceImage);
  await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.8 } } }).png().toFile(acceptedFile);
  const assigned = assignAssetIndices({
    schemaVersion: 4,
    canvas: { width: 100, height: 100 },
    layers: [
      { id: "hero", kind: "hero", editable: "raster", bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 } },
      { id: "badge", kind: "decoration", editable: "raster", bbox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } }
    ]
  });
  const report = await writeDecompositionReport({
    plan: assigned,
    sourceImage,
    outputDir,
    assetResults: new Map([["hero", {
      status: "accepted",
      engine: RECONSTRUCTED_ASSET_ENGINE,
      sourcePixelExact: false,
      reconstructedByChatGpt: true,
      file: acceptedFile,
      intrinsicPx: { width: 40, height: 40 }
    }]])
  });
  assert.equal(report.status, "partial");
  assert.equal(report.transparentAssets.acceptedCount, 1);
  assert.equal(report.transparentAssets.rejectedCount, 1);
  assert.equal(report.layers[0].extractionMode, "chatgpt-reconstructed-asset");
  assert.ok(await reportAssetsReady(report));
});

test("a ChatGPT completion on a uniform background is locally matted with explicit provenance", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finance-reconstructed-asset-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidateFile = path.join(root, "candidate.png");
  const outputDir = path.join(root, "layers");
  await sharp({ create: { width: 300, height: 300, channels: 3, background: "#ffffff" } })
    .composite([{ input: Buffer.from('<svg width="160" height="160"><circle cx="80" cy="80" r="70" fill="#ff5522"/></svg>'), left: 70, top: 70 }])
    .png()
    .toFile(candidateFile);
  const layer = plan().layers.find((item) => item.id === "hero");
  const result = await extractReconstructedAsset({ candidateFile, layer, outputDir });
  assert.equal(result.status, "accepted");
  assert.equal(result.engine, RECONSTRUCTED_ASSET_ENGINE);
  assert.equal(result.sourcePixelExact, false);
  assert.equal(result.reconstructedByChatGpt, true);
  assert.ok((await sharp(result.file).metadata()).hasAlpha);
});
