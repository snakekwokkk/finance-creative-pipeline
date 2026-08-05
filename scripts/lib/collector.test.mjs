import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchPlans, buildSearchPlansForTypes, isReferenceShapeAllowed, isSameImage, selectReferencesForPlans } from "./collector.mjs";

test("default search plan preserves type quotas", () => {
  const plans = buildSearchPlans({}, 10, "2026-08-04");
  assert.deepEqual(plans.map(({ type, count }) => ({ type, count })), [
    { type: "popup", count: 6 },
    { type: "banner", count: 2 },
    { type: "float", count: 2 }
  ]);
  assert.ok(plans[0].keywords.every((keyword) => /弹窗/.test(keyword)));
  assert.ok(plans[1].keywords.every((keyword) => /banner|横幅/i.test(keyword)));
  assert.ok(plans[1].keywords.every((keyword) => /金融|理财|投资|基金|证券/.test(keyword)));
  assert.ok(plans[1].keywords.includes("金融banner"));
  assert.ok(plans[1].keywords.every((keyword) => !/弹窗|浮窗|悬浮|浮标/.test(keyword)));
  assert.ok(plans[2].keywords.every((keyword) => /浮窗|悬浮|浮标/.test(keyword)));
  assert.ok(plans[2].keywords.includes("浮窗"));
  assert.ok(plans[2].keywords.every((keyword) => !/App|界面|页面|运营/i.test(keyword)));
});

test("small test runs use only popup references", () => {
  const plans = buildSearchPlans({}, 3, "2026-08-04");
  assert.deepEqual(plans.map(({ type, count }) => ({ type, count })), [
    { type: "popup", count: 3 }
  ]);
});

test("three-type validation uses one reference from each matching keyword pool", () => {
  const plans = buildSearchPlansForTypes({}, ["popup", "banner", "float"]);
  assert.deepEqual(plans.map(({ type, count }) => ({ type, count })), [
    { type: "popup", count: 1 },
    { type: "banner", count: 1 },
    { type: "float", count: 1 }
  ]);
  assert.ok(plans[0].keywords.every((keyword) => /弹窗/.test(keyword)));
  assert.ok(plans[1].keywords.every((keyword) => /banner|横幅/i.test(keyword)));
  assert.ok(plans[1].keywords.every((keyword) => /金融|理财|投资|基金|证券/.test(keyword)));
  assert.ok(plans[1].keywords.includes("金融banner"));
  assert.ok(plans[1].keywords.every((keyword) => !/弹窗|浮窗|悬浮|浮标/.test(keyword)));
  assert.ok(plans[2].keywords.every((keyword) => /浮窗|悬浮|浮标/.test(keyword)));
  assert.ok(plans[2].keywords.includes("浮窗"));
  assert.ok(plans[2].keywords.every((keyword) => !/App|界面|页面|运营/i.test(keyword)));
});

test("cached references are selected by type quota instead of taking the first ten", () => {
  const references = [
    ...Array.from({ length: 12 }, (_, index) => ({ pinId: `p${index + 1}`, referenceType: "popup" })),
    ...Array.from({ length: 4 }, (_, index) => ({ pinId: `b${index + 1}`, referenceType: "banner" })),
    ...Array.from({ length: 4 }, (_, index) => ({ pinId: `f${index + 1}`, referenceType: "float" }))
  ];
  const plans = buildSearchPlans({}, 10, "2026-08-04");
  const selected = selectReferencesForPlans(references, plans);
  assert.deepEqual(selected.map((item) => item.referenceType), [
    "popup", "popup", "popup", "popup", "popup", "popup", "banner", "banner", "float", "float"
  ]);
});

test("float references reject full-height phone screens", () => {
  assert.equal(isReferenceShapeAllowed("float", 1170, 2532), false);
  assert.equal(isReferenceShapeAllowed("float", 828, 1792), false);
  assert.equal(isReferenceShapeAllowed("float", 1000, 1000), true);
  assert.equal(isReferenceShapeAllowed("float", 800, 1400), true);
  assert.equal(isReferenceShapeAllowed("popup", 828, 1792), true);
});

test("duplicate detection rejects only the same image", () => {
  const history = [{ sha256: "exact", ahash: "00000000", width: 1000, height: 2000 }];
  assert.equal(isSameImage({ sha256: "exact", ahash: "11111111", width: 500, height: 500 }, history), true);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000000", width: 500, height: 1000 }, history), true);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000001", width: 500, height: 1000 }, history), false);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000000", width: 1000, height: 1000 }, history), false);
});
