const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function postCollectionCooldownWindow(collectionCompletedAt, cooldownMinutes = 5) {
  const startedAtMs = Date.parse(collectionCompletedAt);
  if (!Number.isFinite(startedAtMs)) throw new Error("参考图采集缺少有效完成时间");
  const durationMs = Math.max(0, Number(cooldownMinutes) || 0) * 60_000;
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    until: new Date(startedAtMs + durationMs).toISOString()
  };
}

export async function waitForPostCollectionCooldown({
  cooldownUntil,
  pollIntervalMs = 2_000,
  shouldStop = () => false,
  onSnapshot = async () => {},
  now = () => Date.now(),
  wait = sleep
}) {
  let previousRemainingBucket = null;
  while (true) {
    if (shouldStop()) {
      const error = new Error("工作流已停止，采集后冷却将在恢复后按原截止时间继续");
      error.code = "WORKFLOW_ABORTED";
      throw error;
    }
    const remainingMs = Math.max(0, Date.parse(cooldownUntil) - now());
    const remainingBucket = remainingMs === 0 ? 0 : Math.ceil(remainingMs / 60_000);
    if (remainingBucket !== previousRemainingBucket) {
      await onSnapshot({ cooldownComplete: remainingMs === 0, cooldownRemainingMs: remainingMs });
      previousRemainingBucket = remainingBucket;
    }
    if (remainingMs === 0) return { cooldownComplete: true, cooldownRemainingMs: 0 };
    await wait(Math.max(250, Math.min(Number(pollIntervalMs) || 2_000, remainingMs)));
  }
}
