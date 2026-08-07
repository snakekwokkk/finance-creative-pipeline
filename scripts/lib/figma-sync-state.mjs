import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./state.mjs";

export const FIGMA_SYNC_SCHEMA_VERSION = 1;
export const FIGMA_SYNC_STATE_FILE = "figma-sync-state.json";

export function figmaSyncStatePath(runDir) {
  return path.join(runDir, FIGMA_SYNC_STATE_FILE);
}

function now() {
  return new Date().toISOString();
}

function directionKey(index) {
  const value = Number(index);
  if (!Number.isInteger(value) || value < 1) throw new Error("方向编号必须是正整数");
  return String(value);
}

async function hashFile(hash, label, file) {
  hash.update(`${label}\0${path.resolve(file)}\0`);
  hash.update(await fs.readFile(file));
  hash.update("\0");
}

export async function directionArtifactRevision(direction) {
  if (!direction?.previewFile || !direction?.layersFile || !direction?.decompositionReport) {
    throw new Error(`方向 ${direction?.index || "?"} 缺少 Figma 所需产物路径`);
  }
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    index: Number(direction.index),
    type: direction.type,
    width: direction.width,
    height: direction.height,
    sourceUrls: direction.sourceUrls || []
  }));
  await hashFile(hash, "preview", direction.previewFile);
  await hashFile(hash, "layers", direction.layersFile);
  await hashFile(hash, "decomposition", direction.decompositionReport);
  return hash.digest("hex");
}

export function emptyFigmaSyncState({ date, figma }) {
  return {
    schemaVersion: FIGMA_SYNC_SCHEMA_VERSION,
    date,
    figma: { fileKey: figma?.fileKey || null, pageId: figma?.pageId || null },
    section: null,
    directions: {},
    updatedAt: now()
  };
}

function assertTarget(state, { date, figma }) {
  if (state.date !== date) throw new Error(`Figma 同步状态日期不匹配：${state.date} != ${date}`);
  if (state.figma?.fileKey !== figma?.fileKey || state.figma?.pageId !== figma?.pageId) {
    throw new Error("Figma 同步状态与 manifest 的目标文件或页面不匹配");
  }
}

export async function loadFigmaSyncState({ runDir, date, figma }) {
  const file = figmaSyncStatePath(runDir);
  const state = await readJson(file, emptyFigmaSyncState({ date, figma }));
  if (Number(state.schemaVersion) !== FIGMA_SYNC_SCHEMA_VERSION) {
    throw new Error(`不支持的 Figma 同步状态版本：${state.schemaVersion}`);
  }
  state.directions ||= {};
  assertTarget(state, { date, figma });
  return { file, state };
}

export async function readyDirectionSnapshots(readyDirections) {
  const snapshots = [];
  for (const direction of readyDirections || []) {
    snapshots.push({
      index: Number(direction.index),
      type: direction.type,
      revision: await directionArtifactRevision(direction),
      direction
    });
  }
  return snapshots.sort((a, b) => a.index - b.index);
}

export async function reconcileFigmaSyncState({ runDir, date, figma, readyDirections }) {
  const { file, state } = await loadFigmaSyncState({ runDir, date, figma });
  const snapshots = await readyDirectionSnapshots(readyDirections);
  const readyIndexes = new Set(snapshots.map((item) => String(item.index)));

  for (const snapshot of snapshots) {
    const key = directionKey(snapshot.index);
    const previous = state.directions[key];
    if (!previous) {
      state.directions[key] = {
        index: snapshot.index,
        type: snapshot.type,
        revision: snapshot.revision,
        status: "pending",
        discoveredAt: now()
      };
    } else if (previous.revision !== snapshot.revision) {
      state.directions[key] = {
        index: snapshot.index,
        type: snapshot.type,
        revision: snapshot.revision,
        previousRevision: previous.revision,
        status: "pending",
        nodeId: previous.nodeId || null,
        invalidatedAt: now()
      };
    }
  }

  for (const [key, entry] of Object.entries(state.directions)) {
    if (!readyIndexes.has(key) && entry.status !== "superseded") {
      state.directions[key] = { ...entry, status: "superseded", supersededAt: now() };
    }
  }

  state.updatedAt = now();
  await writeJsonAtomic(file, state);
  return { file, state, snapshots };
}

export async function recordFigmaSection({ runDir, date, figma, sectionId, sectionName }) {
  if (!sectionId) throw new Error("必须提供 Figma Section 节点 ID");
  const { file, state } = await loadFigmaSyncState({ runDir, date, figma });
  if (state.section?.id && state.section.id !== sectionId) {
    throw new Error(`已记录另一个日期 Section：${state.section.id}`);
  }
  state.section = {
    id: sectionId,
    name: sectionName || `${date} 自动采集`,
    recordedAt: state.section?.recordedAt || now()
  };
  state.updatedAt = now();
  await writeJsonAtomic(file, state);
  return state;
}

function currentSnapshot(snapshots, index) {
  const snapshot = snapshots.find((item) => item.index === Number(index));
  if (!snapshot) throw new Error(`方向 ${index} 当前不是产物完整的 ready 方向`);
  return snapshot;
}

export async function startFigmaDirection({ runDir, date, figma, readyDirections, index }) {
  const reconciled = await reconcileFigmaSyncState({ runDir, date, figma, readyDirections });
  const snapshot = currentSnapshot(reconciled.snapshots, index);
  const key = directionKey(index);
  const previous = reconciled.state.directions[key];
  if (previous.status === "qa_passed" && previous.revision === snapshot.revision) return reconciled.state;
  reconciled.state.directions[key] = {
    ...previous,
    revision: snapshot.revision,
    status: "syncing",
    attempt: Number(previous.attempt || 0) + 1,
    startedAt: now(),
    error: null
  };
  reconciled.state.updatedAt = now();
  await writeJsonAtomic(reconciled.file, reconciled.state);
  return reconciled.state;
}

export async function recordFigmaDirectionNode({ runDir, date, figma, readyDirections, index, nodeId }) {
  if (!nodeId) throw new Error("必须提供方向 Frame 节点 ID");
  const reconciled = await reconcileFigmaSyncState({ runDir, date, figma, readyDirections });
  const snapshot = currentSnapshot(reconciled.snapshots, index);
  const key = directionKey(index);
  const previous = reconciled.state.directions[key];
  if (previous.status !== "syncing" || previous.revision !== snapshot.revision) {
    throw new Error(`方向 ${index} 未以当前产物版本进入 syncing，不能记录节点`);
  }
  if (previous.nodeId && previous.nodeId !== nodeId) {
    throw new Error(`方向 ${index} 已记录另一个 Frame：${previous.nodeId}`);
  }
  reconciled.state.directions[key] = { ...previous, nodeId, nodeRecordedAt: previous.nodeRecordedAt || now() };
  reconciled.state.updatedAt = now();
  await writeJsonAtomic(reconciled.file, reconciled.state);
  return reconciled.state;
}

export async function completeFigmaDirection({
  runDir,
  date,
  figma,
  readyDirections,
  index,
  nodeId,
  uploadedAssetCount = 0
}) {
  if (!Number.isInteger(uploadedAssetCount) || uploadedAssetCount < 0) {
    throw new Error("方向上传素材数必须是非负整数");
  }
  const reconciled = await reconcileFigmaSyncState({ runDir, date, figma, readyDirections });
  const snapshot = currentSnapshot(reconciled.snapshots, index);
  const key = directionKey(index);
  const previous = reconciled.state.directions[key];
  const completedNodeId = nodeId || previous.nodeId;
  if (!completedNodeId) throw new Error("必须先记录方向 Frame 节点 ID");
  if (previous.status !== "syncing" || previous.revision !== snapshot.revision) {
    throw new Error(`方向 ${index} 未以当前产物版本进入 syncing，不能标记视觉核验完成`);
  }
  reconciled.state.directions[key] = {
    ...previous,
    status: "qa_passed",
    nodeId: completedNodeId,
    uploadedAssetCount,
    completedAt: now(),
    error: null
  };
  reconciled.state.updatedAt = now();
  await writeJsonAtomic(reconciled.file, reconciled.state);
  return reconciled.state;
}

export async function failFigmaDirection({ runDir, date, figma, readyDirections, index, message }) {
  const reconciled = await reconcileFigmaSyncState({ runDir, date, figma, readyDirections });
  const snapshot = currentSnapshot(reconciled.snapshots, index);
  const key = directionKey(index);
  const previous = reconciled.state.directions[key];
  reconciled.state.directions[key] = {
    ...previous,
    revision: snapshot.revision,
    status: "failed",
    failedAt: now(),
    error: String(message || "Figma 同步或视觉核验失败")
  };
  reconciled.state.updatedAt = now();
  await writeJsonAtomic(reconciled.file, reconciled.state);
  return reconciled.state;
}

export async function figmaCompletionSummary({ runDir, date, figma, readyDirections }) {
  const reconciled = await reconcileFigmaSyncState({ runDir, date, figma, readyDirections });
  if (!reconciled.state.section?.id) throw new Error("尚未记录 Figma 日期 Section");
  if (!reconciled.snapshots.length) throw new Error("没有可完成的 ready 方向");

  const incomplete = [];
  const completed = [];
  for (const snapshot of reconciled.snapshots) {
    const entry = reconciled.state.directions[directionKey(snapshot.index)];
    if (entry?.status !== "qa_passed" || entry.revision !== snapshot.revision || !entry.nodeId) {
      incomplete.push({ index: snapshot.index, status: entry?.status || "pending" });
    } else {
      completed.push(entry);
    }
  }
  if (incomplete.length) {
    throw new Error(`仍有 ready 方向未通过 Figma 视觉核验：${incomplete.map((item) => `${item.index}/${item.status}`).join("、")}`);
  }
  return {
    stateFile: reconciled.file,
    section: reconciled.state.section,
    directionIds: completed.map((item) => item.nodeId),
    uploadedAssetCount: completed.reduce((sum, item) => sum + Number(item.uploadedAssetCount || 0), 0),
    completedDirections: completed.map((item) => item.index)
  };
}
