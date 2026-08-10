import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  completeFigmaDirection,
  directionArtifactRevision,
  figmaCompletionSummary,
  reconcileFigmaSyncState,
  recordFigmaDirectionNode,
  recordFigmaSection,
  startFigmaDirection
} from "./figma-sync-state.mjs";

const figma = { fileKey: "file-key", pageId: "0:1" };

async function fixture(t) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "finance-figma-sync-"));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const previewFile = path.join(runDir, "preview.png");
  const layersFile = path.join(runDir, "layers.json");
  const decompositionReport = path.join(runDir, "decomposition-report.json");
  const qaReportFile = path.join(runDir, "figma-qa-report.json");
  const editableFile = path.join(runDir, "editable.png");
  const overlayFile = path.join(runDir, "overlay-50.png");
  const diffFile = path.join(runDir, "difference-heatmap.png");
  const preview = await sharp({ create: { width: 1002, height: 1335, channels: 4, background: "#ffffff" } }).png().toBuffer();
  const previewSha256 = createHash("sha256").update(preview).digest("hex");
  await Promise.all([
    fs.writeFile(previewFile, preview),
    fs.writeFile(editableFile, preview),
    fs.writeFile(overlayFile, preview),
    fs.writeFile(diffFile, preview)
  ]);
  await fs.writeFile(layersFile, JSON.stringify({ schemaVersion: 4, layers: [{ id: "title" }] }));
  await fs.writeFile(decompositionReport, JSON.stringify({ schemaVersion: 4, status: "ready" }));
  await fs.writeFile(qaReportFile, JSON.stringify({
    schemaVersion: 1,
    direction: 1,
    type: "popup",
    canvas: { width: 1002, height: 1335 },
    visual: {
      similarity: 0.99,
      previewSha256,
      editableSha256: previewSha256,
      previewFile,
      editableFile,
      overlayFile,
      overlaySha256: previewSha256,
      diffFile,
      diffSha256: previewSha256
    },
    geometry: { pass: true, maxEdgeErrorPx: 1, maxSizeErrorRatio: 0.005, maxTextBaselineErrorPx: 1 },
    structure: { pass: true },
    assets: { pass: true },
    pass: true,
    reviewedAt: "2026-08-08T00:00:00.000Z"
  }));
  return {
    runDir,
    qaReportFile,
    direction: { index: 1, type: "popup", width: 1002, height: 1335, previewFile, layersFile, decompositionReport }
  };
}

test("artifact revisions change when a ready direction changes", async (t) => {
  const { direction } = await fixture(t);
  const first = await directionArtifactRevision(direction);
  await fs.writeFile(direction.layersFile, JSON.stringify({ schemaVersion: 4, layers: [{ id: "changed" }] }));
  const second = await directionArtifactRevision(direction);
  assert.notEqual(first, second);
});

test("Figma progress is isolated and invalidates a changed direction", async (t) => {
  const { runDir, direction, qaReportFile } = await fixture(t);
  const readyDirections = [direction];
  await recordFigmaSection({ runDir, date: "2026-08-07", figma, sectionId: "100:1" });
  await startFigmaDirection({ runDir, date: "2026-08-07", figma, readyDirections, index: 1 });
  await recordFigmaDirectionNode({ runDir, date: "2026-08-07", figma, readyDirections, index: 1, nodeId: "101:1" });
  let state = await completeFigmaDirection({
    runDir,
    date: "2026-08-07",
    figma,
    readyDirections,
    index: 1,
    uploadedAssetCount: 3,
    qaReportFile
  });
  assert.equal(state.directions["1"].status, "qa_passed");

  await fs.writeFile(direction.previewFile, Buffer.from("preview-v2"));
  state = (await reconcileFigmaSyncState({ runDir, date: "2026-08-07", figma, readyDirections })).state;
  assert.equal(state.directions["1"].status, "pending");
  assert.equal(state.directions["1"].nodeId, "101:1");
  assert.ok(state.directions["1"].previousRevision);
});

test("global completion requires every current ready direction to pass visual QA", async (t) => {
  const { runDir, direction, qaReportFile } = await fixture(t);
  const readyDirections = [direction];
  await recordFigmaSection({ runDir, date: "2026-08-07", figma, sectionId: "100:1", sectionName: "2026-08-07 自动采集" });
  await assert.rejects(
    figmaCompletionSummary({ runDir, date: "2026-08-07", figma, readyDirections }),
    /未通过 Figma 视觉核验/
  );
  await startFigmaDirection({ runDir, date: "2026-08-07", figma, readyDirections, index: 1 });
  await completeFigmaDirection({
    runDir,
    date: "2026-08-07",
    figma,
    readyDirections,
    index: 1,
    nodeId: "101:1",
    uploadedAssetCount: 4,
    qaReportFile
  });
  const summary = await figmaCompletionSummary({ runDir, date: "2026-08-07", figma, readyDirections });
  assert.deepEqual(summary.directionIds, ["101:1"]);
  assert.equal(summary.uploadedAssetCount, 4);
});

test("a direction cannot pass visual QA without a passing report", async (t) => {
  const { runDir, direction } = await fixture(t);
  const readyDirections = [direction];
  await startFigmaDirection({ runDir, date: "2026-08-07", figma, readyDirections, index: 1 });
  await assert.rejects(
    completeFigmaDirection({ runDir, date: "2026-08-07", figma, readyDirections, index: 1, nodeId: "101:1" }),
    /必须提供 --qa-report/
  );
});

test("a stale QA report cannot pass after the preview changes", async (t) => {
  const { runDir, direction, qaReportFile } = await fixture(t);
  const readyDirections = [direction];
  await startFigmaDirection({ runDir, date: "2026-08-07", figma, readyDirections, index: 1 });
  const staleReport = JSON.parse(await fs.readFile(qaReportFile, "utf8"));
  staleReport.visual.previewSha256 = "0".repeat(64);
  await fs.writeFile(qaReportFile, JSON.stringify(staleReport));
  await assert.rejects(
    completeFigmaDirection({ runDir, date: "2026-08-07", figma, readyDirections, index: 1, nodeId: "101:1", qaReportFile }),
    /Preview.*哈希/
  );
});
