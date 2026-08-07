import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
  await fs.writeFile(previewFile, "preview-v1");
  await fs.writeFile(layersFile, JSON.stringify({ schemaVersion: 4, layers: [{ id: "title" }] }));
  await fs.writeFile(decompositionReport, JSON.stringify({ schemaVersion: 4, status: "ready" }));
  return {
    runDir,
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
  const { runDir, direction } = await fixture(t);
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
    uploadedAssetCount: 3
  });
  assert.equal(state.directions["1"].status, "qa_passed");

  await fs.writeFile(direction.previewFile, "preview-v2");
  state = (await reconcileFigmaSyncState({ runDir, date: "2026-08-07", figma, readyDirections })).state;
  assert.equal(state.directions["1"].status, "pending");
  assert.equal(state.directions["1"].nodeId, "101:1");
  assert.ok(state.directions["1"].previousRevision);
});

test("global completion requires every current ready direction to pass visual QA", async (t) => {
  const { runDir, direction } = await fixture(t);
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
    uploadedAssetCount: 4
  });
  const summary = await figmaCompletionSummary({ runDir, date: "2026-08-07", figma, readyDirections });
  assert.deepEqual(summary.directionIds, ["101:1"]);
  assert.equal(summary.uploadedAssetCount, 4);
});
