import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  TRANSPARENT_ASSET_ENGINE,
  assignAssetIndices,
  reportAssetsReady,
  validateSeparateAsset,
  writeDecompositionReport
} from "./transparent-assets.mjs";

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
  const report = await writeDecompositionReport({ plan: assigned, sourceImage, outputDir, assetResults: new Map([["hero", result]]) });
  assert.equal(report.status, "ready");
  assert.equal(report.layers.find((item) => item.id === "hero").assetPlacement.fit, "contain");
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
