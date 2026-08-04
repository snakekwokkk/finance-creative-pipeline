import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchPlans, buildSearchPlansForTypes, isSameImage } from "./collector.mjs";

test("default search plan preserves type quotas", () => {
  const plans = buildSearchPlans({}, 20, "2026-08-04");
  assert.deepEqual(plans.map(({ type, count }) => ({ type, count })), [
    { type: "popup", count: 12 },
    { type: "banner", count: 4 },
    { type: "float", count: 4 }
  ]);
  assert.ok(plans[0].keywords.every((keyword) => /弹窗/.test(keyword)));
  assert.ok(plans[1].keywords.every((keyword) => /banner|横幅/i.test(keyword)));
  assert.ok(plans[2].keywords.every((keyword) => /浮窗|悬浮|浮标/.test(keyword)));
});

test("small test runs use only popup references", () => {
  const plans = buildSearchPlans({}, 3, "2026-08-04");
  assert.deepEqual(plans.map(({ type, count }) => ({ type, count })), [
    { type: "popup", count: 3 }
  ]);
});

test("three-type validation uses two references from each matching keyword pool", () => {
  const plans = buildSearchPlansForTypes({}, ["popup", "banner", "float"]);
  assert.deepEqual(plans.map(({ type, count }) => ({ type, count })), [
    { type: "popup", count: 2 },
    { type: "banner", count: 2 },
    { type: "float", count: 2 }
  ]);
  assert.ok(plans[0].keywords.every((keyword) => /弹窗/.test(keyword)));
  assert.ok(plans[1].keywords.every((keyword) => /banner|横幅/i.test(keyword)));
  assert.ok(plans[2].keywords.every((keyword) => /浮窗|悬浮|浮标/.test(keyword)));
});

test("duplicate detection rejects only the same image", () => {
  const history = [{ sha256: "exact", ahash: "00000000", width: 1000, height: 2000 }];
  assert.equal(isSameImage({ sha256: "exact", ahash: "11111111", width: 500, height: 500 }, history), true);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000000", width: 500, height: 1000 }, history), true);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000001", width: 500, height: 1000 }, history), false);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000000", width: 1000, height: 1000 }, history), false);
});
