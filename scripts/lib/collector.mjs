import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readJson, writeJsonAtomic } from "./state.mjs";
import { screenshotFailure } from "./browser.mjs";

const CSV_HEADER = "index,pin_id,title,source_url,image_url,search_keyword,collected_at,sha256,ahash\n";

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function averageHash(buffer) {
  const pixels = await sharp(buffer).resize(8, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  const avg = [...pixels].reduce((sum, value) => sum + value, 0) / pixels.length;
  return [...pixels].map((value) => (value >= avg ? "1" : "0")).join("");
}

async function loadRecentFingerprints(outputRoot, currentDate, recentDays) {
  const hashes = new Set();
  const pinIds = new Set();
  let entries = [];
  try { entries = await fs.readdir(outputRoot, { withFileTypes: true }); } catch { return { hashes, pinIds }; }
  const cutoff = Date.now() - recentDays * 86_400_000;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === currentDate || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const when = Date.parse(`${entry.name}T00:00:00+08:00`);
    if (!Number.isFinite(when) || when < cutoff) continue;
    const sources = await readJson(path.join(outputRoot, entry.name, "references.json"), []);
    for (const item of sources) {
      if (item.pinId) pinIds.add(item.pinId);
      if (item.ahash) hashes.add(item.ahash);
    }
  }
  return { hashes, pinIds };
}

function looksBlocked(text) {
  return /405|异常访问|安全验证|验证码|访问被阻止|行为验证/.test(text);
}

async function chooseSearchBox(page) {
  const candidates = [
    page.getByRole("textbox"),
    page.locator('input[type="search"]'),
    page.locator('input[placeholder*="搜索"]')
  ];
  for (const locator of candidates) {
    if (await locator.count()) return locator.first();
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
        imageUrl: src
      });
    }
    return rows;
  });
}

async function searchPins(page, keyword, needed) {
  const box = await chooseSearchBox(page);
  await box.fill(keyword);
  await box.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const pageText = await page.locator("body").innerText({ timeout: 15_000 });
  if (looksBlocked(pageText)) throw new Error("花瓣要求安全验证，请在专用浏览器窗口中完成后重试");
  const collected = new Map();
  for (let attempt = 0; attempt < 8 && collected.size < needed; attempt += 1) {
    for (const row of await collectVisiblePins(page)) collected.set(row.pinId, row);
    if (collected.size >= needed) break;
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1000);
  }
  return [...collected.values()];
}

async function downloadImage(context, item, targetFile) {
  const response = await context.request.get(item.imageUrl, { headers: { Referer: item.sourceUrl }, timeout: 60_000 });
  if (!response.ok()) throw new Error(`图片下载失败 ${response.status()}`);
  const buffer = await response.body();
  if (buffer.length < 5_000) throw new Error("图片文件过小，疑似错误响应");
  await fs.writeFile(targetFile, buffer);
  return buffer;
}

export async function collectReferences({ context, page, config, runDir, date, count }) {
  const referencesDir = path.join(runDir, "references");
  await fs.mkdir(referencesDir, { recursive: true });
  const existing = await readJson(path.join(runDir, "references.json"), []);
  if (existing.length >= count) return existing.slice(0, count);

  const recent = await loadRecentFingerprints(config.outputRoot, date, config.collection.recentDays);
  for (const item of existing) {
    recent.pinIds.add(item.pinId);
    recent.hashes.add(item.ahash);
  }
  const learned = await readJson(path.join(config.outputRoot, "latest-keywords.json"), []);
  const seeds = [...config.collection.seedKeywords, ...learned].filter(Boolean);
  const formats = config.collection.formatKeywords;
  const queries = seeds.map((seed, index) => `${seed} ${formats[index % formats.length]}`);
  const results = [...existing];

  for (const query of queries) {
    if (results.length >= count) break;
    const candidates = await searchPins(page, query, Math.max(12, count - results.length + 4));
    for (const candidate of candidates) {
      if (results.length >= count || recent.pinIds.has(candidate.pinId)) continue;
      const tempFile = path.join(referencesDir, `.tmp-${candidate.pinId}`);
      try {
        const buffer = await downloadImage(context, candidate, tempFile);
        const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        const ahash = await averageHash(buffer);
        if (recent.hashes.has(ahash)) {
          await fs.unlink(tempFile).catch(() => {});
          continue;
        }
        const metadata = await sharp(buffer).metadata();
        const extension = metadata.format === "png" ? "png" : metadata.format === "webp" ? "webp" : "jpg";
        const index = results.length + 1;
        const file = path.join(referencesDir, `${String(index).padStart(2, "0")}-${candidate.pinId}.${extension}`);
        await fs.rename(tempFile, file);
        const record = { ...candidate, searchKeyword: query, file, sha256, ahash, collectedAt: new Date().toISOString() };
        results.push(record);
        recent.pinIds.add(candidate.pinId);
        recent.hashes.add(ahash);
        await writeJsonAtomic(path.join(runDir, "references.json"), results);
      } catch {
        await fs.unlink(tempFile).catch(() => {});
      }
    }
  }

  if (results.length < count) {
    await screenshotFailure(page, path.join(runDir, "huaban-incomplete.png"));
    throw new Error(`仅采集到 ${results.length}/${count} 张不重复参考图`);
  }

  const csvRows = results.map((item, index) => [
    index + 1, item.pinId, item.title, item.sourceUrl, item.imageUrl,
    item.searchKeyword, item.collectedAt, item.sha256, item.ahash
  ].map(csvCell).join(","));
  await fs.writeFile(path.join(runDir, "sources.csv"), CSV_HEADER + `${csvRows.join("\n")}\n`, "utf8");
  return results;
}
