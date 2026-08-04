import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readJson, writeJsonAtomic } from "./state.mjs";
import { screenshotFailure } from "./browser.mjs";

const CSV_HEADER = "index,pin_id,reference_type,title,source_url,list_image_url,image_url,width,height,file_size,search_keyword,collected_at,sha256,ahash\n";
const HISTORY_FILE = "reference-history.json";
const DEFAULT_SEARCH_PLANS = [
  {
    type: "popup",
    count: 12,
    keywords: [
      "互联网金融 弹窗", "借贷 活动弹窗", "助贷 营销弹窗", "贷款 优惠券弹窗",
      "金融 福利弹窗", "借款 结果弹窗", "金融 App 弹窗", "贷款 运营弹窗"
    ]
  },
  {
    type: "banner",
    count: 4,
    keywords: [
      "金融banner", "理财banner", "投资理财banner", "金融产品banner",
      "基金理财banner", "证券banner", "简约金融banner"
    ]
  },
  {
    type: "float",
    count: 4,
    keywords: [
      "浮窗", "小浮窗", "悬浮窗素材", "活动浮窗",
      "红包浮窗", "福利浮窗", "悬浮按钮", "活动浮标"
    ]
  }
];

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function averageHash(buffer) {
  const pixels = await sharp(buffer).resize(8, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  const avg = [...pixels].reduce((sum, value) => sum + value, 0) / pixels.length;
  return [...pixels].map((value) => (value >= avg ? "1" : "0")).join("");
}

export function isSameImage(candidate, references) {
  const candidateRatio = candidate.width / candidate.height;
  return references.some((existing) => {
    if (candidate.sha256 && existing.sha256 === candidate.sha256) return true;
    if (!candidate.ahash || existing.ahash !== candidate.ahash || !existing.width || !existing.height) return false;
    return Math.abs(candidateRatio - existing.width / existing.height) <= 0.01;
  });
}

export function isReferenceShapeAllowed(type, width, height, maxFloatHeightToWidthRatio = 2) {
  if (!width || !height) return false;
  if (type !== "float") return true;
  return height / width <= maxFloatHeightToWidthRatio;
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
  const configured = Array.isArray(collection.searchPlans) && collection.searchPlans.length
    ? collection.searchPlans
    : DEFAULT_SEARCH_PLANS;
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

export function buildSearchPlansForTypes(collection, types, countPerType = 2) {
  const configured = Array.isArray(collection.searchPlans) && collection.searchPlans.length
    ? collection.searchPlans
    : DEFAULT_SEARCH_PLANS;
  return types.map((type) => {
    const plan = configured.find((item) => item.type === type);
    if (!plan?.keywords?.length) throw new Error(`配置中缺少 ${type} 类型的搜索词`);
    return { ...plan, count: countPerType };
  });
}

function historyRecord(item, date) {
  return {
    pinId: item.pinId,
    ahash: item.ahash,
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
  const knownPins = new Set(references.map((item) => item.pinId).filter(Boolean));
  let entries = [];
  try { entries = await fs.readdir(outputRoot, { withFileTypes: true }); } catch {}
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const daily = await readJson(path.join(outputRoot, entry.name, "references.json"), []);
    for (const item of daily) {
      if (!item.pinId || knownPins.has(item.pinId)) continue;
      let enriched = item;
      if ((!item.width || !item.height) && item.file) {
        try {
          const metadata = await sharp(item.file).metadata();
          enriched = { ...item, width: metadata.width, height: metadata.height };
        } catch {}
      }
      references.push(historyRecord(enriched, entry.name));
      knownPins.add(item.pinId);
    }
  }
  const state = {
    file: historyFile,
    references,
    pinIds: new Set(references.map((item) => item.pinId).filter(Boolean))
  };
  await writeJsonAtomic(historyFile, { schemaVersion: 1, updatedAt: new Date().toISOString(), references });
  return state;
}

async function appendReferenceHistory(history, item, date) {
  const record = historyRecord(item, date);
  history.references.push(record);
  history.pinIds.add(record.pinId);
  await writeJsonAtomic(history.file, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    references: history.references
  });
}

function looksBlocked(text) {
  return /405|异常访问|安全验证|验证码|访问被阻止|行为验证/.test(text);
}

async function chooseSearchBox(page) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const pageText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (looksBlocked(pageText)) throw new Error("花瓣要求安全验证，请在专用浏览器窗口中完成后重试");
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

async function collectVisiblePins(page) {
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

async function searchPins(page, keyword, needed, excludedPinIds, maxScrolls) {
  const box = await chooseSearchBox(page);
  await box.fill(keyword);
  await box.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const pageText = await page.locator("body").innerText({ timeout: 15_000 });
  if (looksBlocked(pageText)) throw new Error("花瓣要求安全验证，请在专用浏览器窗口中完成后重试");
  const collected = new Map();
  for (let attempt = 0; attempt < maxScrolls && collected.size < needed; attempt += 1) {
    for (const row of await collectVisiblePins(page)) {
      if (!excludedPinIds.has(row.pinId)) collected.set(row.pinId, row);
    }
    if (collected.size >= needed) break;
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1000);
  }
  return [...collected.values()];
}

function detailImageCandidates(images) {
  return images
    .filter((image) => image.visible && image.displayWidth >= 180 && image.displayHeight >= 120)
    .filter((image) => image.urls.some((url) => /hbimg|huaban/i.test(url)))
    .sort((left, right) => {
      const displayDelta = right.displayWidth * right.displayHeight - left.displayWidth * left.displayHeight;
      if (displayDelta) return displayDelta;
      return right.naturalWidth * right.naturalHeight - left.naturalWidth * left.naturalHeight;
    });
}

export async function resolveDetailImageUrls(page, item) {
  await page.goto(item.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  const pageText = await page.locator("body").innerText({ timeout: 15_000 });
  if (looksBlocked(pageText)) throw new Error("花瓣详情页要求安全验证，请在专用浏览器窗口中完成后重试");

  const images = await page.locator("img").evaluateAll((nodes) => nodes.map((image) => {
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
    return {
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0,
      displayWidth: rect.width,
      displayHeight: rect.height,
      naturalWidth: image.naturalWidth || 0,
      naturalHeight: image.naturalHeight || 0,
      urls: [...new Set(urls)]
    };
  }));

  const main = detailImageCandidates(images)[0];
  if (!main) throw new Error(`Pin ${item.pinId} 详情页未找到可见主图`);
  return [...new Set([...main.urls, item.listImageUrl].filter(Boolean))];
}

async function downloadBestImage(context, item, urls, targetFile, minWidth) {
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

async function qualifiedExistingReferences(existing, minWidth, maxFloatHeightToWidthRatio) {
  const qualified = [];
  for (const item of existing) {
    try {
      const [metadata, stat] = await Promise.all([sharp(item.file).metadata(), fs.stat(item.file)]);
      if (!metadata.width || !metadata.height || metadata.width < minWidth) continue;
      const referenceType = inferReferenceType(item);
      if (!isReferenceShapeAllowed(referenceType, metadata.width, metadata.height, maxFloatHeightToWidthRatio)) continue;
      qualified.push({
        ...item,
        referenceType,
        width: metadata.width,
        height: metadata.height,
        fileSize: stat.size
      });
    } catch {}
  }
  return qualified;
}

export async function collectReferences({ context, page, detailPage: suppliedDetailPage = null, config, runDir, date, count }) {
  const referencesDir = path.join(runDir, "references");
  await fs.mkdir(referencesDir, { recursive: true });
  const existing = await readJson(path.join(runDir, "references.json"), []);
  const minWidth = Math.max(1, Number(config.collection.minReferenceWidthPx || 720));
  const perKeywordLimit = Math.max(1, Number(config.collection.perKeywordLimit || 2));
  const maxSearchScrolls = Math.max(1, Number(config.collection.maxSearchScrolls || 20));
  const maxFloatHeightToWidthRatio = Math.max(1, Number(config.collection.maxFloatHeightToWidthRatio || 2));
  const plans = buildSearchPlans(config.collection, count, date);
  const results = await qualifiedExistingReferences(existing, minWidth, maxFloatHeightToWidthRatio);
  if (results.length !== existing.length) await writeJsonAtomic(path.join(runDir, "references.json"), results);
  if (results.length >= count) return results.slice(0, count);

  const history = await loadReferenceHistory(config.outputRoot);
  const detailPage = suppliedDetailPage || await context.newPage();
  const attemptedPinIds = new Set();

  try {
    for (const plan of plans) {
      const existingForType = results.filter((item) => item.referenceType === plan.type).length;
      let acceptedForType = existingForType;
      for (const query of plan.keywords) {
        if (acceptedForType >= plan.count) break;
        const excluded = new Set([...history.pinIds, ...attemptedPinIds]);
        const candidates = await searchPins(
          page,
          query,
          Math.max(8, perKeywordLimit * 4),
          excluded,
          maxSearchScrolls
        );
        let acceptedForQuery = 0;
        for (const candidate of candidates) {
          if (acceptedForType >= plan.count || acceptedForQuery >= perKeywordLimit) break;
          attemptedPinIds.add(candidate.pinId);
          const tempFile = path.join(referencesDir, `.tmp-${candidate.pinId}`);
          try {
            const urls = await resolveDetailImageUrls(detailPage, candidate);
            const downloaded = await downloadBestImage(context, candidate, urls, tempFile, minWidth);
            const { buffer, metadata, imageUrl, fileSize } = downloaded;
            if (!isReferenceShapeAllowed(plan.type, metadata.width, metadata.height, maxFloatHeightToWidthRatio)) {
              throw new Error(`Pin ${candidate.pinId} 为 ${metadata.width}x${metadata.height}，形状更像完整手机页面而不是独立浮窗`);
            }
            const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
            const ahash = await averageHash(buffer);
            if (isSameImage({ sha256, ahash, width: metadata.width, height: metadata.height }, history.references)) {
              await fs.unlink(tempFile).catch(() => {});
              continue;
            }
            const extension = metadata.format === "png" ? "png" : metadata.format === "webp" ? "webp" : "jpg";
            const index = results.length + 1;
            const file = path.join(referencesDir, `${String(index).padStart(2, "0")}-${candidate.pinId}.${extension}`);
            await fs.rename(tempFile, file);
            const record = {
              ...candidate,
              referenceType: plan.type,
              imageUrl,
              file,
              width: metadata.width,
              height: metadata.height,
              fileSize,
              searchKeyword: query,
              sha256,
              ahash,
              collectedAt: new Date().toISOString()
            };
            results.push(record);
            acceptedForType += 1;
            acceptedForQuery += 1;
            await appendReferenceHistory(history, record, date);
            await writeJsonAtomic(path.join(runDir, "references.json"), results);
          } catch (error) {
            await fs.unlink(tempFile).catch(() => {});
            console.warn(`跳过 Pin ${candidate.pinId}：${error.message}`);
          }
        }
      }
      if (acceptedForType < plan.count) {
        throw new Error(`${plan.type} 参考图仅采集到 ${acceptedForType}/${plan.count}，请补充该类型搜索词或处理花瓣页面状态`);
      }
    }
  } finally {
    await detailPage.close().catch(() => {});
  }

  if (results.length < count) {
    await screenshotFailure(page, path.join(runDir, "huaban-incomplete.png"));
    throw new Error(`仅采集到 ${results.length}/${count} 张不重复参考图`);
  }

  const csvRows = results.map((item, index) => [
    index + 1, item.pinId, item.referenceType, item.title, item.sourceUrl, item.listImageUrl, item.imageUrl,
    item.width, item.height, item.fileSize,
    item.searchKeyword, item.collectedAt, item.sha256, item.ahash
  ].map(csvCell).join(","));
  await fs.writeFile(path.join(runDir, "sources.csv"), CSV_HEADER + `${csvRows.join("\n")}\n`, "utf8");
  return results;
}
