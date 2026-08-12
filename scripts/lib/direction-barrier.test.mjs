import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  directionBarrierSnapshot,
  directionCooldownWindow,
  failureCooldownWindow,
  waitForDirectionBarrier,
  waitForFailureCooldown
} from "./direction-barrier.mjs";

test("cooldown starts when decomposition completes", () => {
  const window = directionCooldownWindow("2026-08-12T04:00:00.000Z", 5);
  assert.equal(window.startedAt, "2026-08-12T04:00:00.000Z");
  assert.equal(window.until, "2026-08-12T04:05:00.000Z");
});

test("failed directions use their failure timestamp for the same five-minute gate", () => {
  const window = failureCooldownWindow("2026-08-12T04:00:00.000Z", 5);
  assert.equal(window.startedAt, "2026-08-12T04:00:00.000Z");
  assert.equal(window.until, "2026-08-12T04:05:00.000Z");
});

test("a failed direction cannot advance before its cooldown deadline", async () => {
  const snapshots = [];
  await waitForFailureCooldown({
    cooldownUntil: new Date(Date.now() + 30).toISOString(),
    pollIntervalMs: 5,
    onSnapshot: async (snapshot) => snapshots.push(snapshot)
  });
  assert.equal(snapshots[0].cooldownComplete, false);
  assert.equal(snapshots.at(-1).cooldownComplete, true);
});

test("a failed current Figma direction is surfaced to the failure cooldown gate", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "direction-barrier-"));
  const stateFile = path.join(directory, "figma-sync-state.json");
  await fs.writeFile(stateFile, JSON.stringify({
    directions: { "1": { status: "failed", revision: "r1" } }
  }));
  await assert.rejects(
    waitForDirectionBarrier({
      stateFile,
      directionIndex: 1,
      revision: "r1",
      cooldownUntil: "2026-08-12T00:00:00.000Z"
    }),
    (error) => error.code === "FIGMA_DIRECTION_FAILED"
  );
});

test("next direction needs both cooldown and matching Figma QA", () => {
  const pendingCooldown = directionBarrierSnapshot({
    nowMs: Date.parse("2026-08-12T04:04:00.000Z"),
    cooldownUntil: "2026-08-12T04:05:00.000Z",
    revision: "r1",
    figmaEntry: { status: "qa_passed", revision: "r1", qa: { reportSha256: "hash" } }
  });
  assert.equal(pendingCooldown.complete, false);
  assert.equal(pendingCooldown.figmaComplete, true);

  const staleQa = directionBarrierSnapshot({
    nowMs: Date.parse("2026-08-12T04:06:00.000Z"),
    cooldownUntil: "2026-08-12T04:05:00.000Z",
    revision: "r1",
    figmaEntry: { status: "qa_passed", revision: "old", qa: { reportSha256: "hash" } }
  });
  assert.equal(staleQa.complete, false);

  const complete = directionBarrierSnapshot({
    nowMs: Date.parse("2026-08-12T04:06:00.000Z"),
    cooldownUntil: "2026-08-12T04:05:00.000Z",
    revision: "r1",
    figmaEntry: { status: "qa_passed", revision: "r1", qa: { reportSha256: "hash" } }
  });
  assert.equal(complete.complete, true);
});
