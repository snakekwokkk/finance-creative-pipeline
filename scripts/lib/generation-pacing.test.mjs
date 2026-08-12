import assert from "node:assert/strict";
import test from "node:test";
import { postCollectionCooldownWindow, waitForPostCollectionCooldown } from "./generation-pacing.mjs";

test("first generation starts five minutes after reference collection completes", () => {
  assert.deepEqual(postCollectionCooldownWindow("2026-08-12T10:00:00.000Z", 5), {
    startedAt: "2026-08-12T10:00:00.000Z",
    until: "2026-08-12T10:05:00.000Z"
  });
});

test("post-collection cooldown resumes from its persisted deadline", async () => {
  let nowMs = Date.parse("2026-08-12T10:04:30.000Z");
  const waits = [];
  const result = await waitForPostCollectionCooldown({
    cooldownUntil: "2026-08-12T10:05:00.000Z",
    pollIntervalMs: 10_000,
    now: () => nowMs,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      nowMs += milliseconds;
    }
  });
  assert.equal(waits.reduce((sum, value) => sum + value, 0), 30_000);
  assert.equal(result.cooldownComplete, true);
});
