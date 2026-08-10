import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readJson, writeJsonAtomic } from "./state.mjs";
import { screenshotFailure } from "./browser.mjs";

const CSV_HEADER = "index,pin_id,reference_type,title,source_url,list_image_url,image_url,width,height,file_size,search_keyword,collected_at,sha256,ahash,dhash,provider\n";
const HISTORY_FILE = "reference-history.json";
const REJECTIONS_FILE = "reference-rejections.json";
const POPUP_FORM_PATTERN = /弹窗|弹框|模态|对话框|浮层|遮罩/i;
const POPUP_CONTEXT_PATTERN = /金融|借款|贷款|助贷|理财|投资|基金|证券|保险|还款|额度|免息|红包|福利|优惠|优惠券|新客|会员|任务|奖励|活动|营销|回本|中奖|膨胀|省钱/i;
const POPUP_ATOMIC_PATTERN = /背景|底图|纹理|壁纸|边框|框架|按钮素材|普通按钮|贴纸素材|文字素材|字体|字效|图标素材|icon|logo|banner|横幅|海报|主视觉|促销元素|优惠券元素|3d.*元素/i;
const POPUP_PAGE_PATTERN = /完整页面|页面设计|界面设计|首页|详情页|落地页|启动页/i;
const BANNER_FORM_PATTERN = /banner|横幅|横版|横板|首图|头图|广告|焦点图|宣传|推广|营销|活动/i;
const BANNER_CONTEXT_PATTERN = /金融|借款|贷款|助贷|理财|投资|基金|证券|保险|财富|资产|权益|收益|行情|股票|债券|期货|黄金|新客|会员|红包|福利/i;
const BANNER_BLOCKED_PATTERN = /背景|底图|纹理|壁纸|边框|框架|按钮|贴纸|字体|字效|图标|icon|logo|元素|素材包|样机|模板/i;
const FLOAT_FORM_PATTERN = /浮窗|悬浮窗|浮标|活动入口|福利入口|红包入口|悬浮入口|运营挂件|活动挂件|侧边挂件|运营贴片|活动贴片/i;
const FLOAT_CONTEXT_PATTERN = /金融|借款|贷款|助贷|理财|投资|基金|证券|红包|福利|优惠|领券|新客|会员|任务|奖励|活动|营销/i;
const FLOAT_BLOCKED_PATTERN = /背景|底图|纹理|壁纸|弥散|边框|框架|banner|横幅|海报|按钮文字|贴纸素材|(?:完整|手机|网页|app).*(?:页面|界面)|导航|菜单/i;
const DEFAULT_SEARCH_PLANS = [
  {
    type: "popup",
    count: 6,
    keywords: [
      "互联网金融 弹窗", "借贷 活动弹窗", "助贷 营销弹窗", "贷款 优惠券弹窗",
      "金融 福利弹窗", "借款 结果弹窗", "金融 App 弹窗", "贷款 运营弹窗"
    ]
  },
  {
    type: "banner",
    count: 2,
    keywords: [
      "金融banner", "理财banner", "投资理财banner", "金融产品banner",
      "基金理财banner", "证券banner", "简约金融banner"
    ]
  },
  {
    type: "float",
    count: 2,
    keywords: [
      "金融 活动浮窗", "借款 福利浮窗", "贷款 红包浮窗", "理财 活动浮标",
      "金融 权益入口", "金融 悬浮球", "借款 红包挂件", "金融 会员浮标",
      "金融 3D素材", "金融 插图素材"
    ]
  }
];

export function normalizeReferenceProvider(value = "huaban") {
  const provider = String(value || "huaban").trim().toLowerCase();
  if (provider !== "huaban") throw new Error(`参考图来源仅支持 huaban，当前为 ${value}`);
  return "huaban";
}

export function referenceProvider(item = {}) {
  if (item.provider && String(item.provider).toLowerCase() !== "huaban") return "legacy";
  return "huaban";
}

export function referenceIdentityKey(item = {}) {
  const itemId = String(item.pinId || "").trim();
  return itemId ? `${referenceProvider(item)}:${itemId}` : "";
}

function configuredSearchPlans(collection) {
  return Array.isArray(collection.searchPlans) && collection.searchPlans.length
    ? collection.searchPlans
    : DEFAULT_SEARCH_PLANS;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function averageHash(buffer) {
  const pixels = await sharp(buffer).resize(8, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  const avg = [...pixels].reduce((sum, value) => sum + value, 0) / pixels.length;
  return [...pixels].map((value) => (value >= avg ? "1" : "0")).join("");
}

async function differenceHash(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(17, 16, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width - 1; x += 1) {
      const offset = y * info.width + x;
      bits.push(data[offset] >= data[offset + 1] ? "1" : "0");
    }
  }
  return bits.join("");
}

export function huabanAssetKey(value) {
  try {
    const filename = path.basename(new URL(String(value)).pathname);
    return filename.replace(/_fw\d+(?:webp)?$/i, "") || null;
  } catch {
    return null;
  }
}

export function findDuplicateImage(candidate, references) {
  const candidateRatio = candidate.width / candidate.height;
  const candidateAssetKey = huabanAssetKey(candidate.imageUrl);
  for (const existing of references) {
    if (candidate.sha256 && existing.sha256 === candidate.sha256) {
      return { reference: existing, reason: "sha256" };
    }
    const existingAssetKey = huabanAssetKey(existing.imageUrl);
    if (candidateAssetKey && existingAssetKey === candidateAssetKey) {
      return { reference: existing, reason: "huaban-asset-key" };
    }
    if (!candidate.ahash || !candidate.dhash || !existing.ahash || !existing.dhash) continue;
    if (!existing.width || !existing.height) continue;
    const sameRatio = Math.abs(candidateRatio - existing.width / existing.height) <= 0.01;
    if (sameRatio && candidate.ahash === existing.ahash && candidate.dhash === existing.dhash) {
      return { reference: existing, reason: "combined-perceptual-fingerprint" };
    }
  }
  return null;
}

export function isSameImage(candidate, references) {
  return Boolean(findDuplicateImage(candidate, references));
}

export function minimumReferenceWidth(type, configuredWidth = 720) {
  return type === "float" ? 1 : Math.max(1, Number(configuredWidth || 720));
}

export function assessReferenceTitle(type, title, searchKeyword = "") {
  const value = String(title || "").trim();
  const query = String(searchKeyword || "").trim();
  const reasons = [];
  const hardReasons = [];
  const generic = !value
    || /^(?:pin[-_ ]?\d+|img[-_ ]?\d+)$/i.test(value)
    || /\.(?:png|jpe?g|webp)(?:\s*\([^)]*\))?$/i.test(value);
  if (generic) reasons.push("Pin 标题为空、文件名化或无有效语义，必须继续看图审核");
  if (type === "popup") {
    if (POPUP_ATOMIC_PATTERN.test(value)) hardReasons.push("标题明确表明素材是背景、原子元素、按钮、贴纸或海报");
    if (POPUP_PAGE_PATTERN.test(value) && !POPUP_FORM_PATTERN.test(value)) hardReasons.push("标题明确表明素材是完整页面而不是弹窗");
    if (!POPUP_FORM_PATTERN.test(value) && !POPUP_CONTEXT_PATTERN.test(value)) reasons.push("标题缺少弹窗形态或金融运营语义");
  } else if (type === "banner") {
    if (BANNER_BLOCKED_PATTERN.test(value)) hardReasons.push("标题明确表明素材属于其他行业或只是背景、元素、按钮、模板");
    if (!BANNER_CONTEXT_PATTERN.test(value)) reasons.push("标题缺少金融业务语义");
    if (!BANNER_FORM_PATTERN.test(value)) reasons.push("标题未表明这是完整横幅、首图或营销成品");
  } else if (type === "float") {
    if (FLOAT_BLOCKED_PATTERN.test(value)) hardReasons.push("标题明确表明素材是背景、边框、原子按钮/贴纸或完整页面");
    if (!FLOAT_FORM_PATTERN.test(value) && !FLOAT_FORM_PATTERN.test(query)) reasons.push("标题和搜索词均未表明这是浮窗、浮标、活动入口、运营挂件或活动贴片");
    if (!FLOAT_CONTEXT_PATTERN.test(value) && !FLOAT_CONTEXT_PATTERN.test(query)) reasons.push("标题和搜索词均缺少金融或活动运营语义");
  }
  const decision = hardReasons.length ? "reject" : reasons.length ? "review" : "accept";
  return { accepted: decision !== "reject", decision, reasons: [...hardReasons, ...reasons] };
}

export async function assessPopupReferenceVisual(buffer) {
  const image = sharp(buffer, { failOn: "none" });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) return { accepted: false, reasons: ["图片尺寸信息无效"], metrics: {} };
  if (metadata.hasAlpha) {
    const standalone = await assessFloatReferenceVisual(buffer);
    return {
      ...standalone,
      reasons: standalone.reasons.map((reason) => `透明弹窗主体不完整：${reason}`)
    };
  }
  const { data, info } = await image.resize(96, 96, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let centerLuma = 0;
  let centerPixels = 0;
  let borderLuma = 0;
  let borderPixels = 0;
  let darkBorderPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const luma = data[y * info.width + x];
      const border = x < 12 || y < 12 || x >= info.width - 12 || y >= info.height - 12;
      const center = x >= 14 && y >= 14 && x < info.width - 14 && y < info.height - 14;
      if (border) {
        borderLuma += luma;
        borderPixels += 1;
        if (luma < 90) darkBorderPixels += 1;
      }
      if (center) {
        centerLuma += luma;
        centerPixels += 1;
      }
    }
  }
  const metrics = {
    width: metadata.width,
    height: metadata.height,
    hasAlpha: false,
    centerLuma: centerLuma / centerPixels,
    borderLuma: borderLuma / borderPixels,
    darkBorderRatio: darkBorderPixels / borderPixels
  };
  metrics.modalContrast = metrics.centerLuma - metrics.borderLuma;
  const warnings = [];
  if (metrics.modalContrast < 8 && metrics.darkBorderRatio < 0.15) {
    warnings.push("中心与外围亮度层级不明显，必须由图片内容审核确认是否为完整弹窗");
  }
  return { accepted: true, reasons: [], warnings, metrics };
}

export async function assessBannerReferenceVisual(buffer) {
  const metadata = await sharp(buffer, { failOn: "none" }).metadata();
  if (!metadata.width || !metadata.height) return { accepted: false, reasons: ["图片尺寸信息无效"], metrics: {} };
  const aspectRatio = metadata.width / metadata.height;
  const reasons = [];
  if (aspectRatio < 1.5) reasons.push("画面不是横向 Banner 成品，宽高比低于 1.5");
  return {
    accepted: reasons.length === 0,
    reasons,
    metrics: { width: metadata.width, height: metadata.height, aspectRatio }
  };
}

export async function assessReferenceVisual(type, buffer) {
  if (type === "popup") return assessPopupReferenceVisual(buffer);
  if (type === "banner") return assessBannerReferenceVisual(buffer);
  if (type === "float") return assessFloatReferenceVisual(buffer);
  return { accepted: true, reasons: [], metrics: {} };
}

export async function assessFloatReferenceVisual(buffer) {
  const image = sharp(buffer, { failOn: "none" });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return { accepted: false, reasons: ["图片尺寸信息无效"], metrics: {} };
  }
  // Floating references may be a single financial 3D/illustration element on
  // a flat canvas. Alpha is preferred, but is not required at collection time;
  // semantic review and the later transparent-asset extraction are responsible
  // for deciding whether the subject is usable as a standalone float element.
  if (!metadata.hasAlpha) {
    return {
      accepted: true,
      needsExtraction: true,
      reasons: ["图片没有 Alpha，将在生成阶段作为单元素参考并由 ChatGPT 提取主体"],
      metrics: { width: metadata.width, height: metadata.height, hasAlpha: false, needsExtraction: true }
    };
  }
  const { data, info } = await image
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let foregroundPixels = 0;
  let clearPixels = 0;
  let borderForegroundPixels = 0;
  let borderPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha >= 16) foregroundPixels += 1;
      else clearPixels += 1;
      if (x < 2 || y < 2 || x >= info.width - 2 || y >= info.height - 2) {
        borderPixels += 1;
        if (alpha >= 16) borderForegroundPixels += 1;
      }
    }
  }
  const total = info.width * info.height;
  const metrics = {
    width: metadata.width,
    height: metadata.height,
    hasAlpha: true,
    foregroundRatio: foregroundPixels / total,
    clearRatio: clearPixels / total,
    borderForegroundRatio: borderPixels ? borderForegroundPixels / borderPixels : 0
  };
  const reasons = [];
  if (metrics.foregroundRatio < 0.005) reasons.push("透明画布中的有效主体过少");
  if (metrics.clearRatio < 0.015) reasons.push("主体几乎铺满画布，无法确认是独立元素");
  if (metrics.borderForegroundRatio > 0.95) reasons.push("主体完全贴满画布，更像背景或完整页面");
  return { accepted: reasons.length === 0, reasons, metrics };
}

function inferReferenceType(item) {
  if (item.referenceType) return item.referenceType;
  if (/banner|横幅/i.test(item.searchKeyword || "")) return "banner";
  if (/浮窗|悬浮|浮标/i.test(item.searchKeyword || "")) return "float";
  return "popup";
}

function rotateForDate(values, date) {
  if (!values.length) return [];
  const offset = [...String(date)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % values.length;
  return values.slice(offset).concat(values.slice(0, offset));
}

export function buildSearchPlans(collection, count, date) {
  const configured = configuredSearchPlans(collection);
  let remaining = count;
  const plans = [];
  for (const plan of configured) {
    if (remaining <= 0) break;
    const target = Math.min(remaining, Math.max(0, Number(plan.count || 0)));
    const keywords = rotateForDate([...new Set((plan.keywords || []).filter(Boolean))], date);
    if (!target || !keywords.length) continue;
    plans.push({ type: plan.type, count: target, keywords });
    remaining -= target;
  }
  if (remaining > 0) throw new Error(`搜索计划配额不足，还缺 ${remaining} 张参考图`);
  return plans;
}

export function buildSearchPlansForTypes(collection, types, countPerType = 1) {
  const configured = configuredSearchPlans(collection);
  return types.map((type) => {
    const plan = configured.find((item) => item.type === type);
    if (!plan?.keywords?.length) throw new Error(`配置中缺少 ${type} 类型的搜索词`);
    return { ...plan, count: countPerType };
  });
}

export function selectReferencesForPlans(references, plans) {
  const selected = [];
  for (const plan of plans) {
    const typed = references.filter((item) => inferReferenceType(item) === plan.type).slice(0, plan.count);
    if (typed.length < plan.count) return null;
    selected.push(...typed);
  }
  return selected;
}

export function selectAvailableReferencesForPlans(references, plans) {
  return plans.flatMap((plan) => references
    .filter((item) => inferReferenceType(item) === plan.type)
    .slice(0, plan.count));
}

export function collectionCandidateBudgets(requiredCount, existingCount = 0, collection = {}) {
  const missing = Math.max(0, Number(requiredCount || 0) - Number(existingCount || 0));
  return {
    missing,
    scanned: missing * Math.max(1, Number(collection.maxScannedCandidatesPerDirection || 30)),
    downloaded: missing * Math.max(1, Number(collection.maxDownloadedCandidatesPerDirection || 8))
  };
}

function historyRecord(item, date) {
  return {
    provider: referenceProvider(item),
    pinId: item.pinId,
    ahash: item.ahash,
    dhash: item.dhash,
    sha256: item.sha256,
    referenceType: inferReferenceType(item),
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    width: item.width,
    height: item.height,
    collectedDate: date,
    collectedAt: item.collectedAt
  };
}

async function loadReferenceHistory(outputRoot) {
  const historyFile = path.join(outputRoot, HISTORY_FILE);
  const stored = await readJson(historyFile, { schemaVersion: 1, references: [] });
  const references = Array.isArray(stored.references) ? [...stored.references] : [];
  const knownItems = new Set(references.map(referenceIdentityKey).filter(Boolean));
  let entries = [];
  try { entries = await fs.readdir(outputRoot, { withFileTypes: true }); } catch {}
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const daily = await readJson(path.join(outputRoot, entry.name, "references.json"), []);
    for (const item of daily) {
      const itemKey = referenceIdentityKey(item);
      if (!itemKey || knownItems.has(itemKey)) continue;
      let enriched = item;
      if ((!item.width || !item.height) && item.file) {
        try {
          const metadata = await sharp(item.file).metadata();
          enriched = { ...item, width: metadata.width, height: metadata.height };
        } catch {}
      }
      references.push(historyRecord(enriched, entry.name));
      knownItems.add(itemKey);
    }
  }
  const state = {
    file: historyFile,
    references,
    itemKeys: new Set(references.map(referenceIdentityKey).filter(Boolean))
  };
  await writeJsonAtomic(historyFile, { schemaVersion: 1, updatedAt: new Date().toISOString(), references });
  return state;
}

async function appendReferenceHistory(history, item, date) {
  const record = historyRecord(item, date);
  history.references.push(record);
  history.itemKeys.add(referenceIdentityKey(record));
  await writeJsonAtomic(history.file, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    references: history.references
  });
}

async function loadReferenceRejections(outputRoot, runDir) {
  const globalFile = path.join(outputRoot, REJECTIONS_FILE);
  const dailyFile = path.join(runDir, REJECTIONS_FILE);
  const [globalData, dailyData] = await Promise.all([
    readJson(globalFile, { schemaVersion: 1, rejections: [] }),
    readJson(dailyFile, { schemaVersion: 1, rejections: [] })
  ]);
  const refreshTitleRejection = (item) => {
    if (item.stage !== "title") return item;
    const acceptedNow = assessReferenceTitle(item.referenceType, item.title, item.searchKeyword).accepted;
    if (!acceptedNow) return item.active === false ? { ...item, active: true } : item;
    return item.active === false ? item : { ...item, active: false, revalidatedAt: new Date().toISOString() };
  };
  const global = (Array.isArray(globalData.rejections) ? globalData.rejections : []).map(refreshTitleRejection);
  const daily = (Array.isArray(dailyData.rejections) ? dailyData.rejections : []).map(refreshTitleRejection);
  const updatedAt = new Date().toISOString();
  await Promise.all([
    writeJsonAtomic(globalFile, { ...globalData, schemaVersion: 1, updatedAt, rejections: global }),
    writeJsonAtomic(dailyFile, { ...dailyData, schemaVersion: 1, updatedAt, rejections: daily })
  ]);
  const activeGlobal = global.filter((item) => item.active !== false);
  return {
    globalFile,
    dailyFile,
    global,
    daily,
    itemKeys: new Set(activeGlobal.map(referenceIdentityKey).filter(Boolean))
  };
}

async function recordReferenceRejection(state, item) {
  const record = { ...item, provider: referenceProvider(item), active: true, rejectedAt: new Date().toISOString() };
  const itemKey = referenceIdentityKey(record);
  if (!state.itemKeys.has(itemKey)) {
    state.global = state.global.filter((existing) => referenceIdentityKey(existing) !== itemKey).concat(record);
    state.itemKeys.add(itemKey);
  }
  state.daily = state.daily.filter((existing) => referenceIdentityKey(existing) !== itemKey).concat(record);
  const updatedAt = new Date().toISOString();
  await Promise.all([
    writeJsonAtomic(state.globalFile, { schemaVersion: 1, updatedAt, rejections: state.global }),
    writeJsonAtomic(state.dailyFile, { schemaVersion: 1, updatedAt, rejections: state.daily })
  ]);
}

export function looksLikeBlockedPage(text) {
  const value = String(text || "");
  return /异常访问|安全验证|验证码|访问被阻止|行为验证/.test(value)
    || /(?:^|\s)405(?:\s|$)[\s\S]{0,80}(?:method\s+not\s+allowed|not\s+allowed)/i.test(value)
    || /(?:method\s+not\s+allowed|not\s+allowed)[\s\S]{0,80}(?:^|\s)405(?:\s|$)/i.test(value);
}

async function chooseHuabanSearchBox(page) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const pageText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (looksLikeBlockedPage(pageText)) throw new Error("花瓣要求安全验证，请在专用浏览器窗口中完成后重试");
    const candidates = [
      page.getByRole("textbox"),
      page.locator('input[type="search"]'),
      page.locator('input[placeholder*="搜索"]')
    ];
    for (const locator of candidates) {
      if (await locator.count()) return locator.first();
    }
    await page.waitForTimeout(500);
  }
  throw new Error("未找到花瓣搜索框");
}

async function collectVisibleHuabanPins(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const rows = [];
    for (const anchor of document.querySelectorAll('a[href^="/pins/"]')) {
      const match = anchor.getAttribute("href")?.match(/^\/pins\/(\d+)/);
      const img = anchor.querySelector("img");
      if (!match || !img || seen.has(match[1])) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith("data:")) continue;
      seen.add(match[1]);
      rows.push({
        pinId: match[1],
        title: img.alt || anchor.textContent?.trim() || `pin-${match[1]}`,
        sourceUrl: new URL(anchor.href, location.origin).href,
        listImageUrl: src
      });
    }
    return rows;
  });
}

async function searchHuabanPins(page, keyword, needed, excludedPinIds, maxScrolls) {
  const box = await chooseHuabanSearchBox(page);
  await box.fill(keyword);
  await box.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const pageText = await page.locator("body").innerText({ timeout: 15_000 });
  if (looksLikeBlockedPage(pageText)) throw new Error("花瓣要求安全验证，请在专用浏览器窗口中完成后重试");
  const collected = new Map();
  for (let attempt = 0; attempt < maxScrolls && collected.size < needed; attempt += 1) {
    for (const row of await collectVisibleHuabanPins(page)) {
      row.provider = "huaban";
      if (!excludedPinIds.has(row.pinId)) collected.set(row.pinId, row);
    }
    if (collected.size >= needed) break;
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1000);
  }
  return [...collected.values()];
}

async function searchPins(page, keyword, needed, excludedPinIds, maxScrolls) {
  return searchHuabanPins(page, keyword, needed, excludedPinIds, maxScrolls);
}

function detailImageCandidates(images) {
  const sourcePattern = /hbimg|huaban/i;
  const candidates = images
    .filter((image) => image.visible && image.displayWidth >= 180 && image.displayHeight >= 120)
    .filter((image) => image.urls.some((url) => sourcePattern.test(url)));
  return candidates
    .sort((left, right) => {
      const displayDelta = right.displayWidth * right.displayHeight - left.displayWidth * left.displayHeight;
      if (displayDelta) return displayDelta;
      return right.naturalWidth * right.naturalHeight - left.naturalWidth * left.naturalHeight;
    });
}

export function exposedImageWidthHint(url) {
  const value = String(url || "");
  const pathHint = value.match(/(?:_|-)fw(\d{2,5})/i)?.[1];
  const queryHint = value.match(/[?&](?:w|width)=(\d{2,5})(?:&|$)/i)?.[1];
  return Number(pathHint || queryHint || 0);
}

export function selectHighestExposedImage(urls, naturalWidth = 0, naturalHeight = 0) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  const imageUrl = unique.reduce((best, current) => (
    exposedImageWidthHint(current) > exposedImageWidthHint(best) ? current : best
  ), unique[0] || null);
  const hintedWidth = exposedImageWidthHint(imageUrl);
  const width = Math.max(Number(naturalWidth || 0), hintedWidth);
  const height = naturalWidth && naturalHeight && width
    ? Math.round(Number(naturalHeight) * width / Number(naturalWidth))
    : Number(naturalHeight || 0);
  return { imageUrl, width, height };
}

export async function resolveDetailImageCandidate(page, item) {
  const listImageUrls = [item.listImageUrl].filter(Boolean);
  const response = await page.goto(item.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  if ([401, 403, 405, 429].includes(response?.status())) {
    throw new Error(`花瓣详情页返回 HTTP ${response.status()}，请在专用浏览器窗口中完成验证后重试`);
  }
  const pageText = await page.locator("body").innerText({ timeout: 15_000 });
  if (looksLikeBlockedPage(pageText)) throw new Error("花瓣详情页要求安全验证，请在专用浏览器窗口中完成后重试");

  const images = await page.locator("img").evaluateAll((nodes, visibleListImageUrls) => {
    const assetKey = (value) => {
      try {
        const filename = new URL(value, location.href).pathname.split("/").pop() || "";
        return filename.replace(/\.[^.]+$/, "");
      } catch {
        return "";
      }
    };
    const listAssetKeys = new Set(visibleListImageUrls.map(assetKey).filter(Boolean));
    return nodes.map((image) => {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      const urls = [];
      const add = (value) => {
        if (!value || value.startsWith("data:")) return;
        try { urls.push(new URL(value, location.href).href); } catch {}
      };
      const addSrcset = (value) => {
        for (const candidate of String(value || "").split(",")) add(candidate.trim().split(/\s+/)[0]);
      };
      add(image.currentSrc);
      add(image.src);
      add(image.getAttribute("data-src"));
      add(image.getAttribute("data-original"));
      addSrcset(image.srcset);
      addSrcset(image.getAttribute("data-srcset"));
      const uniqueUrls = [...new Set(urls)];
      return {
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0,
        isMainPin: /mainpinimage/i.test(image.getAttribute("elementtiming") || "")
          || Boolean(image.closest('[data-test-id="story-pin-image-block"], [data-test-id="closeup-image"]'))
          || uniqueUrls.some((url) => listAssetKeys.has(assetKey(url))),
        displayWidth: rect.width,
        displayHeight: rect.height,
        naturalWidth: image.naturalWidth || 0,
        naturalHeight: image.naturalHeight || 0,
        urls: uniqueUrls
      };
    });
  }, listImageUrls);

  const main = detailImageCandidates(images)[0];
  if (!main) {
    throw new Error(`Pin ${item.pinId} 详情页未找到可见主图`);
  }
  const urls = [...new Set([...main.urls, ...listImageUrls].filter(Boolean))];
  const selected = selectHighestExposedImage(urls, main.naturalWidth, main.naturalHeight);
  return {
    imageUrl: selected.imageUrl,
    urls,
    width: selected.width || Math.round(main.displayWidth),
    height: selected.height || Math.round(main.displayHeight)
  };
}

export async function resolveDetailImageUrls(page, item) {
  return (await resolveDetailImageCandidate(page, item)).urls;
}

async function downloadBestImage(context, item, urls, targetFile, minWidth, browserPage = null) {
  let best = null;
  for (const imageUrl of urls.slice(0, 12)) {
    try {
      const response = await context.request.get(imageUrl, { headers: { Referer: item.sourceUrl }, timeout: 60_000 });
      if (!response.ok()) continue;
      const buffer = await response.body();
      if (buffer.length < 5_000) continue;
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height || !metadata.format) continue;
      const candidate = { imageUrl, buffer, metadata, fileSize: buffer.length };
      if (!best || metadata.width * metadata.height > best.metadata.width * best.metadata.height) best = candidate;
    } catch {}
  }
  if (!best) throw new Error(`Pin ${item.pinId} 详情页图片下载失败`);
  if (best.metadata.width < minWidth) {
    throw new Error(`Pin ${item.pinId} 最佳可见图片仅 ${best.metadata.width}x${best.metadata.height}，低于 ${minWidth}px 宽度门槛`);
  }
  await fs.writeFile(targetFile, best.buffer);
  return best;
}

export function referenceCollectionRequiresUserAction(error) {
  return /登录|验证码|安全验证|异常访问|访问被阻止|权限|account session|access denied|captcha|waf|连续\s*2\s*次失败[\s\S]*提示词已填写但未能提交/i
    .test(String(error?.message || error));
}

async function reviewCandidateBatch({ visualReviewer, type, candidates, attempts }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const audit = await visualReviewer({ type, candidates });
      const byPin = new Map((audit?.candidates || []).map((item) => [String(item.pinId), item]));
      if (byPin.size !== candidates.length) throw new Error("参考图视觉审核结果数量与候选图不一致");
      return candidates.map((candidate) => {
        const result = byPin.get(String(candidate.pinId));
        if (!result) throw new Error(`参考图视觉审核漏掉 Pin ${candidate.pinId}`);
        return {
          candidate,
          audit: {
            ...result,
            chatUrl: audit.chatUrl || null,
            chatTitle: audit.chatTitle || null,
            responseFile: audit.responseFile || null,
            reviewedAt: new Date().toISOString()
          }
        };
      });
    } catch (error) {
      if (referenceCollectionRequiresUserAction(error)) throw error;
      lastError = error;
      console.warn(`${type} 参考图内容审核第 ${attempt}/${attempts} 次失败：${error.message}`);
    }
  }
  throw new Error(`${type} 参考图内容审核连续 ${attempts} 次失败：${lastError?.message || "未知错误"}`);
}

async function qualifiedExistingReferences(existing, minWidth, rejectionState, {
  sourceProvider,
  visualReviewer,
  visualReviewBatchSize,
  visualReviewMaxAttempts
}) {
  const qualified = [];
  const pending = [];
  for (const item of existing) {
    try {
      if (referenceProvider(item) !== sourceProvider) continue;
      const referenceType = inferReferenceType(item);
      const titleAudit = assessReferenceTitle(referenceType, item.title, item.searchKeyword);
      if (titleAudit.decision === "reject") {
        await recordReferenceRejection(rejectionState, {
          pinId: item.pinId,
          referenceType,
          title: item.title,
          sourceUrl: item.sourceUrl,
          searchKeyword: item.searchKeyword,
          stage: "title",
          reasons: titleAudit.reasons
        });
        continue;
      }
      const [buffer, stat] = await Promise.all([fs.readFile(item.file), fs.stat(item.file)]);
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height || metadata.width < minimumReferenceWidth(referenceType, minWidth)) continue;
      const visualAudit = await assessReferenceVisual(referenceType, buffer);
      if (!visualAudit.accepted) {
        await recordReferenceRejection(rejectionState, {
          pinId: item.pinId,
          referenceType,
          title: item.title,
          sourceUrl: item.sourceUrl,
          searchKeyword: item.searchKeyword,
          stage: "visual",
          reasons: visualAudit.reasons,
          metrics: visualAudit.metrics
        });
        continue;
      }
      const candidate = {
        ...item,
        referenceType,
        width: metadata.width,
        height: metadata.height,
        fileSize: stat.size
      };
      if (item.contentAudit?.accepted === true) qualified.push(candidate);
      else pending.push(candidate);
    } catch {}
  }

  if (pending.length && typeof visualReviewer !== "function") {
    throw new Error("参考图内容审核器未配置，不能只凭标题接受缓存素材");
  }
  for (const type of ["popup", "banner", "float"]) {
    const typed = pending.filter((item) => item.referenceType === type);
    for (let offset = 0; offset < typed.length; offset += visualReviewBatchSize) {
      const batch = typed.slice(offset, offset + visualReviewBatchSize);
      const reviewed = await reviewCandidateBatch({
        visualReviewer,
        type,
        candidates: batch,
        attempts: visualReviewMaxAttempts
      });
      for (const { candidate, audit } of reviewed) {
        if (audit.accepted) {
          qualified.push({ ...candidate, contentAudit: audit });
          continue;
        }
        await recordReferenceRejection(rejectionState, {
          pinId: candidate.pinId,
          referenceType: type,
          title: candidate.title,
          sourceUrl: candidate.sourceUrl,
          searchKeyword: candidate.searchKeyword,
          stage: "content",
          reasons: audit.reasons,
          metrics: audit
        });
      }
    }
  }
  return qualified;
}

async function cleanupCandidateTempFiles(referencesDir) {
  const files = await fs.readdir(referencesDir).catch(() => []);
  await Promise.all(files
    .filter((file) => /^\.(?:download|candidate)-/.test(file))
    .map((file) => fs.unlink(path.join(referencesDir, file)).catch(() => {})));
}

export async function collectReferences({
  context,
  page,
  detailPage: suppliedDetailPage = null,
  config,
  runDir,
  date,
  count,
  visualReviewer
}) {
  const sourceProvider = normalizeReferenceProvider(config.collection.source || "huaban");
  const referencesDir = path.join(runDir, "references");
  await fs.mkdir(referencesDir, { recursive: true });
  await cleanupCandidateTempFiles(referencesDir);
  const existing = await readJson(path.join(runDir, "references.json"), []);
  const minWidth = Math.max(1, Number(config.collection.minReferenceWidthPx || 720));
  const maxSearchScrolls = Math.max(1, Number(config.collection.maxSearchScrolls || 20));
  const maxCandidatesPerKeyword = Math.max(1, Number(config.collection.maxCandidatesPerKeyword || 3));
  const visualReviewBatchSize = Math.max(1, Math.min(5, Number(config.collection.visualReviewBatchSize || 5)));
  const visualReviewMaxAttempts = Math.max(1, Number(config.collection.visualReviewMaxAttempts || 2));
  const plans = buildSearchPlans(config.collection, count, date);
  const rejectionState = await loadReferenceRejections(config.outputRoot, runDir);
  const results = await qualifiedExistingReferences(existing, minWidth, rejectionState, {
    sourceProvider,
    visualReviewer,
    visualReviewBatchSize,
    visualReviewMaxAttempts
  });
  if (existing.length) await writeJsonAtomic(path.join(runDir, "references.json"), results);
  const existingSelection = selectReferencesForPlans(results, plans);
  if (existingSelection) return existingSelection;
  if (typeof visualReviewer !== "function") throw new Error("参考图内容审核器未配置，不能只凭标题采集素材");

  const history = await loadReferenceHistory(config.outputRoot);
  const detailPage = suppliedDetailPage || await context.newPage();
  const attemptedPinIds = new Set();
  const referenceFiles = await fs.readdir(referencesDir).catch(() => []);
  let nextReferenceIndex = Math.max(0, ...referenceFiles
    .map((file) => Number(file.match(/^(\d+)-/)?.[1] || 0))) + 1;

  try {
    for (const plan of plans) {
      const existingForType = results.filter((item) => item.referenceType === plan.type).length;
      let acceptedForType = existingForType;
      const budgets = collectionCandidateBudgets(plan.count, existingForType, config.collection);
      let scannedCandidates = 0;
      let downloadedCandidates = 0;
      let queryCursor = 0;
      let emptyQueries = 0;
      const reviewQueue = [];
      const auditStateFile = path.join(runDir, "reference-audit-chats.json");
      const auditState = await readJson(auditStateFile, { schemaVersion: 1, chats: {}, batches: [], queuedCandidates: {} });
      auditState.queuedCandidates ||= {};

      const persistReviewQueue = async () => {
        const latestAuditState = await readJson(auditStateFile, { schemaVersion: 1, chats: {}, batches: [], queuedCandidates: {} });
        latestAuditState.queuedCandidates ||= {};
        latestAuditState.queuedCandidates[plan.type] = reviewQueue;
        await writeJsonAtomic(auditStateFile, latestAuditState);
      };

      const flushReviewQueue = async ({ allowPartialRecovery = false } = {}) => {
        if (!reviewQueue.length || acceptedForType >= plan.count) {
          reviewQueue.length = 0;
          await persistReviewQueue();
          return false;
        }
        if (!allowPartialRecovery && reviewQueue.length < visualReviewBatchSize) return false;
        const batch = reviewQueue.splice(0, visualReviewBatchSize);
        await persistReviewQueue();
        let reviewed;
        try {
          reviewed = await reviewCandidateBatch({
            visualReviewer,
            type: plan.type,
            candidates: batch,
            attempts: visualReviewMaxAttempts
          });
        } catch (error) {
          reviewQueue.unshift(...batch);
          await persistReviewQueue();
          if (referenceCollectionRequiresUserAction(error)) throw error;
          console.warn(`${plan.type} 候选批次内容审核失败，已保留该批供下次恢复：${error.message}`);
          return false;
        }
        reviewed.sort((left, right) => Number(right.audit.score || 0) - Number(left.audit.score || 0));
        for (const { candidate, audit } of reviewed) {
          if (audit.accepted && acceptedForType < plan.count) {
            if (downloadedCandidates >= budgets.downloaded) continue;
            downloadedCandidates += 1;
            const downloadFile = path.join(referencesDir, `.download-${sourceProvider}-${candidate.pinId}`);
            let finalFile = null;
            try {
              const downloaded = await downloadBestImage(
                context,
                candidate,
                candidate.imageUrls,
                downloadFile,
                minimumReferenceWidth(plan.type, minWidth),
                detailPage
              );
              const { buffer, metadata, imageUrl, fileSize } = downloaded;
              const visualAudit = await assessReferenceVisual(plan.type, buffer);
              if (!visualAudit.accepted) {
                await recordReferenceRejection(rejectionState, {
                  pinId: candidate.pinId,
                  referenceType: plan.type,
                  title: candidate.title,
                  sourceUrl: candidate.sourceUrl,
                  imageUrl: candidate.imageUrl,
                  searchKeyword: candidate.searchKeyword,
                  stage: "visual",
                  reasons: visualAudit.reasons,
                  metrics: visualAudit.metrics
                });
                console.warn(`跳过 Pin ${candidate.pinId}：${visualAudit.reasons.join("；")}`);
                continue;
              }
              const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
              const [ahash, dhash] = await Promise.all([averageHash(buffer), differenceHash(buffer)]);
              const duplicate = findDuplicateImage(
                { sha256, ahash, dhash, imageUrl, width: metadata.width, height: metadata.height },
                [...history.references, ...results]
              );
              if (duplicate) {
                const matchedPinId = duplicate.reference.pinId || "未知";
                const reason = `与历史 Pin ${matchedPinId} 重复（${duplicate.reason}）`;
                await recordReferenceRejection(rejectionState, {
                  pinId: candidate.pinId,
                  referenceType: plan.type,
                  title: candidate.title,
                  sourceUrl: candidate.sourceUrl,
                  imageUrl,
                  searchKeyword: candidate.searchKeyword,
                  stage: "duplicate",
                  reasons: [reason],
                  metrics: {
                    matchReason: duplicate.reason,
                    matchedPinId,
                    matchedImageUrl: duplicate.reference.imageUrl || null,
                    sha256,
                    ahash,
                    dhash
                  }
                });
                console.warn(`跳过 Pin ${candidate.pinId}：${reason}`);
                continue;
              }
              const extension = metadata.format === "png" ? "png" : metadata.format === "webp" ? "webp" : "jpg";
              const destination = path.join(referencesDir, `${String(nextReferenceIndex).padStart(2, "0")}-${candidate.pinId}.${extension}`);
              nextReferenceIndex += 1;
              await fs.rename(downloadFile, destination);
              finalFile = destination;
              const record = {
                ...candidate,
                imageUrl,
                file: finalFile,
                width: metadata.width,
                height: metadata.height,
                fileSize,
                sha256,
                ahash,
                dhash,
                contentAudit: audit,
                collectedAt: new Date().toISOString()
              };
              delete record.imageUrls;
              results.push(record);
              acceptedForType += 1;
              await appendReferenceHistory(history, record, date);
              await writeJsonAtomic(path.join(runDir, "references.json"), results);
            } catch (error) {
              if (referenceCollectionRequiresUserAction(error)) throw error;
              await recordReferenceRejection(rejectionState, {
                pinId: candidate.pinId,
                referenceType: plan.type,
                title: candidate.title,
                sourceUrl: candidate.sourceUrl,
                imageUrl: candidate.imageUrl,
                searchKeyword: candidate.searchKeyword,
                stage: "technical",
                reasons: [error.message]
              });
              console.warn(`跳过 Pin ${candidate.pinId}：${error.message}`);
            } finally {
              if (!finalFile) await fs.unlink(downloadFile).catch(() => {});
            }
            continue;
          }
          if (!audit.accepted) {
            await recordReferenceRejection(rejectionState, {
              pinId: candidate.pinId,
              referenceType: plan.type,
              title: candidate.title,
              sourceUrl: candidate.sourceUrl,
              imageUrl: candidate.imageUrl,
              searchKeyword: candidate.searchKeyword,
              stage: "content",
              reasons: audit.reasons,
              metrics: audit
            });
          }
        }
        await persistReviewQueue();
        return true;
      };

      const pendingCandidates = Array.isArray(auditState.chats?.[plan.type]?.pendingCandidates)
        ? auditState.chats[plan.type].pendingCandidates
        : [];
      for (const candidate of pendingCandidates) {
        if (!candidate?.pinId || !candidate?.imageUrl || candidate.referenceType !== plan.type) continue;
        reviewQueue.push(candidate);
        attemptedPinIds.add(String(candidate.pinId));
      }
      if (reviewQueue.length) {
        scannedCandidates += reviewQueue.length;
        await flushReviewQueue({ allowPartialRecovery: true });
      }
      const queuedCandidates = Array.isArray(auditState.queuedCandidates?.[plan.type])
        ? auditState.queuedCandidates[plan.type]
        : [];
      for (const candidate of queuedCandidates) {
        if (!candidate?.pinId || !candidate?.imageUrl || candidate.referenceType !== plan.type) continue;
        if (attemptedPinIds.has(String(candidate.pinId))) continue;
        reviewQueue.push(candidate);
        attemptedPinIds.add(String(candidate.pinId));
      }
      if (reviewQueue.length) scannedCandidates += reviewQueue.length;
      if (reviewQueue.length >= visualReviewBatchSize) await flushReviewQueue();

      while (acceptedForType < plan.count
        && scannedCandidates < budgets.scanned
        && downloadedCandidates < budgets.downloaded
        && emptyQueries < plan.keywords.length * 2) {
        const query = plan.keywords[queryCursor % plan.keywords.length];
        queryCursor += 1;
        const excluded = new Set([
          ...history.references
            .filter((item) => referenceProvider(item) === sourceProvider)
            .map((item) => item.pinId),
          ...rejectionState.global
            .filter((item) => item.active !== false && referenceProvider(item) === sourceProvider)
            .map((item) => item.pinId),
          ...attemptedPinIds
        ]);
        const candidates = await searchPins(
          page,
          query,
          Math.min(maxCandidatesPerKeyword, budgets.scanned - scannedCandidates),
          excluded,
          maxSearchScrolls
        );
        if (!candidates.length) emptyQueries += 1;
        else emptyQueries = 0;
        for (const candidate of candidates) {
          if (acceptedForType >= plan.count
            || scannedCandidates >= budgets.scanned
            || downloadedCandidates >= budgets.downloaded) break;
          scannedCandidates += 1;
          attemptedPinIds.add(candidate.pinId);
          const titleAudit = assessReferenceTitle(plan.type, candidate.title, query);
          if (titleAudit.decision === "reject") {
            await recordReferenceRejection(rejectionState, {
              pinId: candidate.pinId,
              referenceType: plan.type,
              title: candidate.title,
              sourceUrl: candidate.sourceUrl,
              searchKeyword: query,
              stage: "title",
              reasons: titleAudit.reasons
            });
            console.warn(`跳过 Pin ${candidate.pinId}：${titleAudit.reasons.join("；")}`);
            continue;
          }
          try {
            const resolved = await resolveDetailImageCandidate(detailPage, candidate);
            const minimumWidth = minimumReferenceWidth(plan.type, minWidth);
            if (resolved.width < minimumWidth) {
              throw new Error(`Pin ${candidate.pinId} 最佳可见图片仅 ${resolved.width}x${resolved.height}，低于 ${minimumWidth}px 宽度门槛`);
            }
            if (plan.type === "banner" && resolved.width / resolved.height < 1.5) {
              throw new Error("画面不是横向 Banner 成品，宽高比低于 1.5");
            }
            reviewQueue.push({
              ...candidate,
              referenceType: plan.type,
              imageUrl: resolved.imageUrl,
              imageUrls: resolved.urls,
              width: resolved.width,
              height: resolved.height,
              searchKeyword: query,
              titleAudit
            });
            await persistReviewQueue();
            if (reviewQueue.length >= visualReviewBatchSize) await flushReviewQueue();
          } catch (error) {
            if (referenceCollectionRequiresUserAction(error)) throw error;
            if (/低于\s*\d+px\s*宽度门槛|宽高比低于/.test(error.message)) {
              await recordReferenceRejection(rejectionState, {
                pinId: candidate.pinId,
                referenceType: plan.type,
                title: candidate.title,
                sourceUrl: candidate.sourceUrl,
                searchKeyword: query,
                stage: "technical",
                reasons: [error.message]
              });
            }
            console.warn(`跳过 Pin ${candidate.pinId}：${error.message}`);
          }
        }
      }
      await persistReviewQueue();
      if (reviewQueue.length) {
        console.warn(`${plan.type} 尚有 ${reviewQueue.length}/${visualReviewBatchSize} 个候选，未提交不足 5 条的审核批次，已保存供下次补齐`);
      }
      if (acceptedForType < plan.count) {
        console.warn(`${plan.type} 参考图仅采集到 ${acceptedForType}/${plan.count}；已扫描 ${scannedCandidates}/${budgets.scanned} 个候选，审核通过后下载验证 ${downloadedCandidates}/${budgets.downloaded} 张，跳过缺失方向并继续`);
      }
    }
  } finally {
    await detailPage.close().catch(() => {});
    await cleanupCandidateTempFiles(referencesDir);
  }

  const selected = selectAvailableReferencesForPlans(results, plans);
  if (selected.length < count) {
    await screenshotFailure(page, path.join(runDir, `${sourceProvider}-incomplete.png`));
    console.warn(`本轮获得 ${selected.length}/${count} 张不重复参考图；缺失方向将在 manifest 中记录后跳过`);
  }

  const csvRows = results.map((item, index) => [
    index + 1, item.pinId, item.referenceType, item.title, item.sourceUrl, item.listImageUrl, item.imageUrl,
    item.width, item.height, item.fileSize,
    item.searchKeyword, item.collectedAt, item.sha256, item.ahash, item.dhash, referenceProvider(item)
  ].map(csvCell).join(","));
  await fs.writeFile(path.join(runDir, "sources.csv"), CSV_HEADER + `${csvRows.join("\n")}\n`, "utf8");
  return selected;
}
