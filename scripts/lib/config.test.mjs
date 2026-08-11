import assert from "node:assert/strict";
import test from "node:test";
import { migrateConfig } from "./config.mjs";

test("legacy three-link review batches migrate to the current five-link default", () => {
  const defaults = {
    schemaVersion: 2,
    browser: { mode: "visible" },
    collection: { visualReviewBatchSize: 5, visualReviewTimeoutMinutes: 4 },
    figma: { fileKey: "YOUR_FIGMA_FILE_KEY", pageId: "0:1" }
  };
  const migrated = migrateConfig({
    collection: { visualReviewBatchSize: 3 },
    figma: { fileKey: "personal-key", pageId: "96:1056" }
  }, defaults);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.collection.visualReviewBatchSize, 5);
  assert.equal(migrated.collection.visualReviewTimeoutMinutes, 4);
  assert.deepEqual(migrated.figma, { fileKey: "personal-key", pageId: "96:1056" });
  assert.equal(migrated.browser.mode, "visible");
});

test("schema-versioned user batch overrides normalize to the required five-link batch", () => {
  const defaults = { schemaVersion: 2, collection: { visualReviewBatchSize: 5 } };
  const migrated = migrateConfig({ schemaVersion: 2, collection: { visualReviewBatchSize: 4 } }, defaults);
  assert.equal(migrated.collection.visualReviewBatchSize, 5);
});
