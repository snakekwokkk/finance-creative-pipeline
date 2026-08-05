import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  assessBannerReferenceVisual,
  assessFloatReferenceVisual,
  assessPopupReferenceVisual,
  assessReferenceTitle,
  buildSearchPlans,
  buildSearchPlansForTypes,
  collectionCandidateBudgets,
  isSameImage,
  looksLikeBlockedPage,
  minimumReferenceWidth,
  referenceCollectionRequiresUserAction,
  selectAvailableReferencesForPlans,
  selectReferencesForPlans
} from "./collector.mjs";

test("reference collection security blockers stop the workflow globally", () => {
  assert.equal(referenceCollectionRequiresUserAction(new Error("花瓣详情页要求安全验证")), true);
  assert.equal(referenceCollectionRequiresUserAction(new Error("花瓣验证码待处理")), true);
  assert.equal(referenceCollectionRequiresUserAction(new Error("Pin 详情页图片下载失败")), false);
});

test("normal Huaban collection counts do not look like HTTP 405 blockers", () => {
  assert.equal(looksLikeBlockedPage("H5—活动页面 4056采集1 天前更新"), false);
  assert.equal(looksLikeBlockedPage("推荐画板 405 采集"), false);
  assert.equal(looksLikeBlockedPage("405 Method Not Allowed"), true);
  assert.equal(looksLikeBlockedPage("请完成行为验证后继续访问"), true);
});

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
  assert.ok(plans[2].keywords.every((keyword) => /浮窗|悬浮|浮标|入口|挂件|贴片/.test(keyword)));
  assert.ok(plans[2].keywords.every((keyword) => /金融|借款|贷款|理财|借贷/.test(keyword)));
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
  assert.ok(plans[2].keywords.every((keyword) => /浮窗|悬浮|浮标|入口|挂件|贴片/.test(keyword)));
  assert.ok(plans[2].keywords.every((keyword) => /金融|借款|贷款|理财|借贷/.test(keyword)));
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

test("partial reference selection preserves type order and separates scan from download budgets", () => {
  const plans = buildSearchPlansForTypes({}, ["popup", "banner", "float"]);
  const references = [
    { pinId: "p1", referenceType: "popup" },
    { pinId: "b1", referenceType: "banner" }
  ];
  assert.deepEqual(selectAvailableReferencesForPlans(references, plans).map((item) => item.pinId), ["p1", "b1"]);
  assert.deepEqual(collectionCandidateBudgets(1, 0, {}), { missing: 1, scanned: 30, downloaded: 8 });
  assert.deepEqual(collectionCandidateBudgets(2, 1, {
    maxScannedCandidatesPerDirection: 24,
    maxDownloadedCandidatesPerDirection: 6
  }), { missing: 1, scanned: 24, downloaded: 6 });
  assert.deepEqual(collectionCandidateBudgets(2, 2, {}), { missing: 0, scanned: 0, downloaded: 0 });
});

test("float references do not inherit the normal minimum-width gate", () => {
  assert.equal(minimumReferenceWidth("float", 720), 1);
  assert.equal(minimumReferenceWidth("popup", 720), 720);
  assert.equal(minimumReferenceWidth("banner", 720), 720);
});

test("float titles require a complete finance operations entry and reject obvious unrelated assets", () => {
  assert.equal(assessReferenceTitle("float", "金融新客福利活动浮窗").accepted, true);
  assert.equal(assessReferenceTitle("float", "借款红包活动入口").accepted, true);
  assert.equal(assessReferenceTitle("float", "商品零售按钮文字贴纸素材").accepted, false);
  assert.equal(assessReferenceTitle("float", "常规背景系列蓝白色渐变弥散背景").accepted, false);
  assert.equal(assessReferenceTitle("float", "蓝紫色渐变长条形立体按钮元素").accepted, false);
  assert.equal(assessReferenceTitle("float", "金融活动浮窗按钮素材").accepted, false);
  assert.equal(assessReferenceTitle("float", "金融活动贴片文字贴纸").accepted, false);
  assert.equal(assessReferenceTitle("float", "金融 App 完整页面界面").accepted, false);
  assert.equal(assessReferenceTitle("float", "限时红包福利", "借款 福利浮窗").accepted, true);
  assert.equal(assessReferenceTitle("float", "限时抢购活动贴片", "金融 运营贴片").accepted, true);
  assert.equal(assessReferenceTitle("float", "pin-123456", "借款 福利浮窗").decision, "review");
  assert.equal(assessReferenceTitle("float", "pin-123456", "借款 福利浮窗").accepted, true);
  assert.equal(assessReferenceTitle("float", "蓝色渐变背景", "借款 福利浮窗").accepted, false);
  assert.equal(assessReferenceTitle("float", "促销系列软3D红包+金色边元素", "借款 福利浮窗").accepted, true);
  assert.equal(assessReferenceTitle("float", "立体感炫彩会员标识", "金融 福利入口").accepted, true);
  assert.equal(assessReferenceTitle("float", "促销活动红包金币贴纸", "贷款 红包浮窗").accepted, true);
});

test("popup titles reject generic pins and atomic elements while keeping complete finance popups", () => {
  assert.equal(assessReferenceTitle("popup", "借款红包活动弹窗").accepted, true);
  assert.equal(assessReferenceTitle("popup", "一单回本@1x").accepted, true);
  assert.equal(assessReferenceTitle("popup", "pin-6987548153").decision, "review");
  assert.equal(assessReferenceTitle("popup", "pin-6987548153").accepted, true);
  assert.equal(assessReferenceTitle("popup", "促销系列拟物风膨胀优惠券元素").accepted, false);
});

test("banner titles require finance plus finished horizontal marketing semantics", () => {
  assert.equal(assessReferenceTitle("banner", "金融保险产品营销商务2.5D首图").accepted, true);
  assert.equal(assessReferenceTitle("banner", "基金证券直播宣传课程封面横版banner").accepted, true);
  assert.equal(assessReferenceTitle("banner", "教育培训资格认证横板课程封面").accepted, false);
  assert.equal(assessReferenceTitle("banner", "金融科技渐变背景素材").accepted, false);
  assert.equal(assessReferenceTitle("banner", "02wv087ndvwo3h3cftiq0n3537.png (1920×1080)").decision, "review");
});

test("popup luminance is advisory so low-contrast modals still reach content review", async () => {
  const valid = await sharp({ create: { width: 900, height: 1600, channels: 3, background: "#303030" } })
    .composite([{ input: { create: { width: 700, height: 900, channels: 3, background: "#f8f8f8" } }, left: 100, top: 350 }])
    .webp()
    .toBuffer();
  const fullPage = await sharp({ create: { width: 900, height: 1600, channels: 3, background: "#f4c5b8" } }).webp().toBuffer();
  assert.equal((await assessPopupReferenceVisual(valid)).accepted, true);
  const ambiguous = await assessPopupReferenceVisual(fullPage);
  assert.equal(ambiguous.accepted, true);
  assert.match(ambiguous.warnings[0], /图片内容审核/);
});

test("banner visual audit keeps horizontal width semantics", async () => {
  const horizontal = await sharp({ create: { width: 1200, height: 500, channels: 3, background: "#ffffff" } }).webp().toBuffer();
  const square = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#ffffff" } }).webp().toBuffer();
  assert.equal((await assessBannerReferenceVisual(horizontal)).accepted, true);
  assert.equal((await assessBannerReferenceVisual(square)).accepted, false);
});

test("float visual audit accepts small transparent subjects and rejects opaque backgrounds", async () => {
  const smallFloat = await sharp({
    create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{ input: await sharp({
    create: { width: 70, height: 70, channels: 4, background: { r: 255, g: 60, b: 80, alpha: 1 } }
  }).png().toBuffer(), left: 25, top: 25 }]).png().toBuffer();
  const background = await sharp({
    create: { width: 300, height: 500, channels: 3, background: { r: 180, g: 210, b: 255 } }
  }).jpeg().toBuffer();
  assert.equal((await assessFloatReferenceVisual(smallFloat)).accepted, true);
  assert.equal((await assessFloatReferenceVisual(background)).accepted, false);
});

test("duplicate detection rejects only the same image", () => {
  const history = [{ sha256: "exact", ahash: "00000000", width: 1000, height: 2000 }];
  assert.equal(isSameImage({ sha256: "exact", ahash: "11111111", width: 500, height: 500 }, history), true);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000000", width: 500, height: 1000 }, history), true);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000001", width: 500, height: 1000 }, history), false);
  assert.equal(isSameImage({ sha256: "other", ahash: "00000000", width: 1000, height: 1000 }, history), false);
});
