import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  assertPassingFigmaQaReport,
  createFigmaVisualQaReport,
  evaluateGeometryQa,
  FIGMA_VISUAL_QA_THRESHOLDS
} from "./figma-visual-qa.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finance-figma-visual-qa-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previewFile = path.join(root, "preview.png");
  const editableFile = path.join(root, "editable.png");
  const geometryFile = path.join(root, "geometry.json");
  const image = await sharp({ create: { width: 240, height: 240, channels: 4, background: "#eef3ff" } })
    .composite([{ input: Buffer.from('<svg width="120" height="80"><rect width="120" height="80" rx="16" fill="#ff6633"/></svg>'), left: 60, top: 80 }])
    .png()
    .toBuffer();
  await Promise.all([fs.writeFile(previewFile, image), fs.writeFile(editableFile, image)]);
  await fs.writeFile(geometryFile, JSON.stringify({
    layers: [{ id: "card", critical: true, expected: { x: 60, y: 80, width: 120, height: 80 }, actual: { x: 60, y: 80, width: 120, height: 80 } }],
    structure: {
      previewHasImage: true,
      visualBaseHidden: true,
      visualBaseLocked: true,
      editableElementsVisible: true,
      correctCanvasSize: true,
      noArtworkAutoLayout: true,
      noGenericPlaceholders: true,
      officialIconsOnly: true
    },
    assets: { acceptedExpected: 0, acceptedVisible: 0, missingAcceptedLayerIds: [], criticalMissingLayerIds: [], rejectedVisibleLayerIds: [], residualMatteLayerIds: [] }
  }));
  return { root, previewFile, editableFile, geometryFile };
}

test("identical Figma renders generate passing overlay and heatmap evidence", async (t) => {
  const input = await fixture(t);
  const { report, reportFile } = await createFigmaVisualQaReport({
    direction: 9,
    type: "float",
    previewFile: input.previewFile,
    editableFile: input.editableFile,
    geometryFile: input.geometryFile,
    outputDir: path.join(input.root, "qa")
  });
  assert.equal(report.pass, true);
  assert.equal(report.visual.similarity, 1);
  assert.ok((await fs.stat(report.visual.overlayFile)).size > 100);
  assert.ok((await fs.stat(report.visual.diffFile)).size > 100);
  assert.equal(report.visual.overlaySha256.length, 64);
  assert.equal(report.visual.diffSha256.length, 64);
  assert.equal(assertPassingFigmaQaReport(report, { index: 9, type: "float", width: 240, height: 240 }), report);
  assert.ok((await fs.stat(reportFile)).size > 100);
});

test("geometry beyond the strict edge threshold fails", () => {
  const result = evaluateGeometryQa({
    layers: [{ id: "title", critical: true, kind: "text", expected: { x: 10, y: 10, width: 100, height: 20 }, actual: { x: 13, y: 10, width: 100, height: 20 } }]
  }, FIGMA_VISUAL_QA_THRESHOLDS.banner);
  assert.equal(result.pass, false);
  assert.equal(result.maxEdgeErrorPx, 3);
});

test("missing non-critical layers and text baselines still fail exact geometry QA", () => {
  const missingLayer = evaluateGeometryQa({
    layers: [{ id: "decoration", critical: false, expected: { x: 1, y: 2, width: 10, height: 10 }, actual: null }]
  }, FIGMA_VISUAL_QA_THRESHOLDS.popup);
  assert.equal(missingLayer.pass, false);

  const missingBaseline = evaluateGeometryQa({
    layers: [{ id: "title", kind: "text", expected: { x: 1, y: 2, width: 10, height: 10 }, actual: { x: 1, y: 2, width: 10, height: 10 } }]
  }, FIGMA_VISUAL_QA_THRESHOLDS.popup);
  assert.equal(missingBaseline.pass, false);
  assert.deepEqual(missingBaseline.missingTextBaselineLayerIds, ["title"]);
});
