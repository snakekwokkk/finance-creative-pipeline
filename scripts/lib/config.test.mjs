import assert from "node:assert/strict";
import test from "node:test";
import { migrateConfig } from "./config.mjs";

test("legacy review batches and direction quotas migrate to the current required defaults", () => {
  const defaults = {
    schemaVersion: 6,
    browser: { mode: "visible" },
    collection: {
      referenceCount: 10,
      visualReviewBatchSize: 6,
      visualReviewMaxBatchesPerType: 3,
      visualReviewTimeoutMinutes: 4,
      visualReviewSavedConversationPollIntervalSeconds: 15,
      visualReviewSubmissionIntervalSeconds: 30,
      visualReviewRateLimitCooldownMinutes: 10,
      searchPlans: [
        { type: "popup", count: 5, keywords: ["默认弹窗词"] },
        { type: "banner", count: 3, keywords: ["默认横幅词"] },
        { type: "float", count: 2, keywords: ["默认浮窗词"] }
      ]
    },
    generation: { directionCount: 10, directionCooldownMinutes: 5, figmaCompletionPollIntervalSeconds: 2 },
    figma: { fileKey: "YOUR_FIGMA_FILE_KEY", pageId: "0:1" }
  };
  const migrated = migrateConfig({
    collection: {
      referenceCount: 8,
      visualReviewBatchSize: 3,
      searchPlans: [
        { type: "popup", count: 6, keywords: ["我的弹窗词"] },
        { type: "banner", count: 2, keywords: ["我的横幅词"] },
        { type: "float", count: 2, keywords: ["我的浮窗词"] }
      ]
    },
    generation: { directionCount: 8 },
    figma: { fileKey: "personal-key", pageId: "96:1056" }
  }, defaults);
  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.collection.referenceCount, 10);
  assert.equal(migrated.collection.visualReviewBatchSize, 6);
  assert.equal(migrated.collection.visualReviewMaxBatchesPerType, 3);
  assert.equal(migrated.generation.directionCount, 10);
  assert.equal(migrated.generation.directionCooldownMinutes, 5);
  assert.equal(migrated.generation.figmaCompletionPollIntervalSeconds, 2);
  assert.deepEqual(migrated.collection.searchPlans.map(({ type, count, keywords }) => ({ type, count, keywords })), [
    { type: "popup", count: 5, keywords: ["我的弹窗词"] },
    { type: "banner", count: 3, keywords: ["我的横幅词"] },
    { type: "float", count: 2, keywords: ["我的浮窗词"] }
  ]);
  assert.equal(migrated.collection.visualReviewTimeoutMinutes, 4);
  assert.equal(migrated.collection.visualReviewSavedConversationPollIntervalSeconds, 15);
  assert.equal(migrated.collection.visualReviewSubmissionIntervalSeconds, 30);
  assert.equal(migrated.collection.visualReviewRateLimitCooldownMinutes, 10);
  assert.deepEqual(migrated.figma, { fileKey: "personal-key", pageId: "96:1056" });
  assert.equal(migrated.browser.mode, "visible");
});

test("schema-versioned user batch overrides normalize to the required six-link batch", () => {
  const defaults = {
    schemaVersion: 7,
    collection: { referenceCount: 10, visualReviewBatchSize: 6, visualReviewMaxBatchesPerType: 3, searchPlans: [] },
    generation: { directionCount: 10, directionCooldownMinutes: 5, figmaCompletionPollIntervalSeconds: 2 }
  };
  const migrated = migrateConfig({ schemaVersion: 2, collection: { visualReviewBatchSize: 4 } }, defaults);
  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.collection.visualReviewBatchSize, 6);
  assert.equal(migrated.collection.visualReviewMaxBatchesPerType, 3);
});
