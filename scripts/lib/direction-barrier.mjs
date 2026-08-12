import fs from "node:fs/promises";
import { readJson } from "./state.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function directionCooldownWindow(decompositionCompletedAt, cooldownMinutes = 5) {
  const startedAtMs = Date.parse(decompositionCompletedAt);
  if (!Number.isFinite(startedAtMs)) throw new Error("方向缺少有效的拆图完成时间");
  const durationMs = Math.max(0, Number(cooldownMinutes) || 0) * 60_000;
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    until: new Date(startedAtMs + durationMs).toISOString()
  };
}

export function failureCooldownWindow(failedAt, cooldownMinutes = 5) {
  const startedAtMs = Date.parse(failedAt);
  if (!Number.isFinite(startedAtMs)) throw new Error("方向失败记录缺少有效时间");
  const durationMs = Math.max(0, Number(cooldownMinutes) || 0) * 60_000;
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    until: new Date(startedAtMs + durationMs).toISOString()
  };
}

export async function waitForFailureCooldown({
  cooldownUntil,
  pollIntervalMs = 2_000,
  shouldStop = () => false,
  onSnapshot = async () => {}
}) {
  let previousRemainingBucket = null;
  while (true) {
    if (shouldStop()) {
      const error = new Error("工作流已停止，失败方向冷却将在恢复后按原截止时间继续");
      error.code = "WORKFLOW_ABORTED";
      throw error;
    }
    const remainingMs = Math.max(0, Date.parse(cooldownUntil) - Date.now());
    const remainingBucket = remainingMs === 0 ? 0 : Math.ceil(remainingMs / 60_000);
    if (remainingBucket !== previousRemainingBucket) {
      await onSnapshot({ cooldownComplete: remainingMs === 0, cooldownRemainingMs: remainingMs });
      previousRemainingBucket = remainingBucket;
    }
    if (remainingMs === 0) return { cooldownComplete: true, cooldownRemainingMs: 0 };
    await sleep(Math.max(250, Math.min(Number(pollIntervalMs) || 2_000, remainingMs)));
  }
}

export function directionBarrierSnapshot({ nowMs = Date.now(), cooldownUntil, figmaEntry, revision }) {
  const cooldownRemainingMs = Math.max(0, Date.parse(cooldownUntil) - nowMs);
  const figmaComplete = figmaEntry?.status === "qa_passed"
    && Boolean(figmaEntry?.qa?.reportSha256)
    && figmaEntry?.revision === revision;
  return {
    cooldownComplete: cooldownRemainingMs === 0,
    cooldownRemainingMs,
    figmaComplete,
    complete: cooldownRemainingMs === 0 && figmaComplete,
    figmaStatus: figmaEntry?.status || "pending"
  };
}

export async function waitForDirectionBarrier({
  stateFile,
  directionIndex,
  revision,
  cooldownUntil,
  pollIntervalMs = 2_000,
  shouldStop = () => false,
  onSnapshot = async () => {}
}) {
  let previousKey = null;
  while (true) {
    if (shouldStop()) {
      const error = new Error("工作流已停止，方向闭环等待将在恢复后继续");
      error.code = "WORKFLOW_ABORTED";
      throw error;
    }
    const state = await readJson(stateFile, { directions: {} });
    const snapshot = directionBarrierSnapshot({
      cooldownUntil,
      figmaEntry: state?.directions?.[String(directionIndex)],
      revision
    });
    if (snapshot.figmaStatus === "failed" && state?.directions?.[String(directionIndex)]?.revision === revision) {
      const error = new Error(`方向 ${directionIndex} 的 Figma 组合或质检失败，将记录结果并在 5 分钟冷却后尝试下一方向`);
      error.code = "FIGMA_DIRECTION_FAILED";
      throw error;
    }
    const key = `${snapshot.cooldownComplete}:${snapshot.figmaComplete}:${snapshot.figmaStatus}`;
    if (key !== previousKey) {
      await onSnapshot(snapshot);
      previousKey = key;
    }
    if (snapshot.complete) return snapshot;
    await sleep(Math.max(250, Math.min(Number(pollIntervalMs) || 2_000, snapshot.cooldownRemainingMs || Infinity)));
  }
}
