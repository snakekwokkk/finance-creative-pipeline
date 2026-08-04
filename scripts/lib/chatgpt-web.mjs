import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readJson, writeJsonAtomic } from "./state.mjs";
import { screenshotFailure } from "./browser.mjs";
import {
  assignAssetIndices,
  isRasterAsset,
  reportAssetsReady,
  validateSeparateAsset,
  writeDecompositionReport
} from "./transparent-assets.mjs";

function minuteTimeout(value) {
  return Math.max(1, Number(value || 1)) * 60_000;
}

function extractJson(text) {
  const marked = text.match(/FINANCE_SPEC_START\s*([\s\S]*?)\s*FINANCE_SPEC_END/);
  const candidate = marked?.[1] || text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (!candidate) throw new Error("ChatGPT 回复中未找到结构化 JSON");
  return JSON.parse(candidate.trim());
}

function extractMarkedJson(text, start, end) {
  const candidate = text.match(new RegExp(`${start}\\s*([\\s\\S]*?)\\s*${end}`))?.[1] || text.match(/```json\\s*([\\s\\S]*?)```/i)?.[1];
  if (!candidate) throw new Error(`ChatGPT 回复中未找到 ${start} JSON`);
  return JSON.parse(candidate.trim());
}

async function composer(page) {
  const candidates = [
    page.locator("#prompt-textarea"),
    page.locator('[contenteditable="true"][data-lexical-editor="true"]'),
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"][aria-label*="ChatGPT"]'),
    page.locator('[contenteditable="true"][data-placeholder*="ChatGPT"]'),
    page.locator('textarea[placeholder*="消息"]'),
    page.locator('textarea[placeholder*="Message"]'),
    page.locator('textarea[placeholder*="ChatGPT"]')
  ];
  for (const candidate of candidates) {
    const count = await candidate.count();
    for (let index = 0; index < count; index += 1) {
      const item = candidate.nth(index);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  throw new Error("未找到 ChatGPT 输入框，可能需要登录或页面已更新");
}

async function waitForComposer(page, timeout = 30_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try { return await composer(page); }
    catch (error) { lastError = error; }
    await page.waitForTimeout(500);
  }
  throw lastError;
}

export function chatGptLoginRequired({ url = "", visibleLoginControls = 0 } = {}) {
  let authPage = false;
  try { authPage = /^\/auth(?:\/|$)/.test(new URL(url).pathname); } catch {}
  return authPage || visibleLoginControls > 0;
}

export function chatGptSessionAuthenticated(session) {
  return Boolean(session?.user || session?.accessToken);
}

async function readChatGptSession(page) {
  return page.evaluate(async () => {
    try {
      const response = await fetch("/api/auth/session", { credentials: "include" });
      const data = await response.json().catch(() => null);
      return { status: response.status, authenticated: Boolean(data?.user || data?.accessToken) };
    } catch (error) {
      return { status: 0, authenticated: false, error: error.message };
    }
  });
}

async function visibleLoginControlCount(page) {
  const candidates = [
    page.getByRole("button", { name: /^(登录|Log in)$/i }),
    page.getByRole("link", { name: /^(登录|Log in)$/i })
  ];
  let visible = 0;
  for (const candidate of candidates) {
    for (let index = 0; index < await candidate.count(); index += 1) {
      if (await candidate.nth(index).isVisible().catch(() => false)) visible += 1;
    }
  }
  return visible;
}

export async function ensureChatGptLoggedIn(page) {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  const visibleLoginControls = await visibleLoginControlCount(page);
  if (chatGptLoginRequired({ url: page.url(), visibleLoginControls })) {
    throw new Error("ChatGPT 专用浏览器尚未登录，请先运行登录设置");
  }
  const session = await readChatGptSession(page);
  if (!session.authenticated) {
    throw new Error(`ChatGPT 账户会话尚未建立（状态 ${session.status || "不可用"}），请先运行登录设置`);
  }
  await waitForComposer(page);
}

async function navigateWithRetry(page, url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForComposer(page);
      return;
    } catch (error) {
      lastError = error;
      if (!/ERR_ABORTED|navigation.*interrupted|net::ERR_/i.test(String(error?.message || error)) || attempt === 1) throw error;
      await page.waitForTimeout(1500);
    }
  }
  throw lastError;
}

export function dailyProjectName(config, date) {
  const prefix = String(config?.chatgpt?.projectNamePrefix || "金融运营素材").trim();
  return `${prefix} ${date}`;
}

export function projectBaseUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/g\/g-p-[^/]+/);
    return match ? `${url.origin}${match[0]}` : null;
  } catch {
    return null;
  }
}

export function conversationUrl(value) {
  try {
    const url = new URL(value);
    if (!/\/c\/[^/]+/.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function directionChatTitle(type, typeIndex) {
  const prefix = { popup: "弹窗", banner: "Banner", float: "浮窗" }[type];
  if (!prefix) throw new Error(`不支持的方向类型：${type}`);
  return `${prefix}${typeIndex + 1}`;
}

function conversationId(value) {
  try { return new URL(value).pathname.match(/\/c\/([^/]+)/)?.[1] || null; }
  catch { return null; }
}

export async function ensureDirectionChatTitle(page, project, chatUrl, title) {
  const id = conversationId(chatUrl);
  if (!project?.enabled || !id) throw new Error(`无法将 ChatGPT 方向聊天命名为“${title}”：缺少有效的项目或聊天 URL`);
  let renameError;
  try {
    await navigateWithRetry(page, project.url);
    const selector = `[data-testid="project-conversation-overflow-menu"] button[data-conversation-options-trigger="${id}"]`;
    const started = Date.now();
    let trigger;
    while (Date.now() - started < 30_000) {
      const candidates = page.locator(selector);
      if (await candidates.count()) {
        trigger = candidates.last();
        if (await trigger.isVisible().catch(() => false)) break;
      }
      trigger = null;
      await page.waitForTimeout(500);
    }
    if (!trigger) throw new Error("未在日期项目中找到对应的方向聊天");
    if (!(await trigger.getAttribute("aria-label") || "").includes(`“${title}”`)) {
      await trigger.click();
      const rename = page.getByRole("menuitem", { name: /重命名|Rename/i });
      if (!(await rename.count())) throw new Error("未找到聊天重命名菜单项");
      await rename.last().click();
      const editor = page.locator('input[name="title-editor"][aria-label]');
      await editor.last().waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => { throw new Error("未找到聊天标题输入框"); });
      await editor.last().fill(title);
      await editor.last().press("Enter");
      await page.waitForFunction(
        ({ selector: target, expected }) => [...document.querySelectorAll(target)]
          .some((button) => (button.getAttribute("aria-label") || "").includes(`“${expected}”`)),
        { selector, expected: title },
        { timeout: 15_000 }
      );
    }
  } catch (error) {
    renameError = error;
  }
  try { await navigateWithRetry(page, chatUrl); }
  catch (error) { throw new Error(`聊天“${title}”重命名后无法返回原对话：${error.message}`); }
  if (renameError) throw new Error(`无法将 ChatGPT 方向聊天命名为“${title}”：${renameError.message}`);
  return { title, chatUrl };
}

async function expandProjects(page) {
  const candidates = page.locator('button[aria-expanded]');
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const button = candidates.nth(index);
    const text = (await button.innerText().catch(() => "")).trim();
    if (!/^(项目|Projects)$/i.test(text)) continue;
    if (await button.getAttribute("aria-expanded") === "false") await button.click();
    return;
  }
}

async function findProjectRow(page, name) {
  await expandProjects(page);
  const rows = page.locator('[class*="project-unfurl-row"]');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if ((await row.innerText().catch(() => "")).trim() === name) return row;
  }
  return null;
}

async function findVisibleNewProjectButton(page) {
  const buttons = page.getByRole("button", { name: /新项目|New project/i });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible().catch(() => false)) return button;
  }
  return null;
}

async function waitForProjectUi(page, name, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const existing = await findProjectRow(page, name);
    if (existing) return { existing, create: null };
    const create = await findVisibleNewProjectButton(page);
    if (create) return { existing: null, create };
    await page.waitForTimeout(500);
  }
  throw new Error("未找到 ChatGPT 新项目按钮，无法按日期整理自动任务聊天");
}

async function visibleTextInput(page, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const inputs = page.locator('input[name="projectName"], #project-name, input[type="text"]');
    const count = await inputs.count();
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      if (await input.isVisible().catch(() => false)) return input;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("未找到 ChatGPT 项目名称输入框，项目创建界面可能已更新");
}

export async function ensureDailyProject(page, config, date) {
  if (config?.chatgpt?.dailyProjects === false) {
    return { enabled: false, name: null, url: "https://chatgpt.com/", baseUrl: null };
  }
  const name = dailyProjectName(config, date);
  await navigateWithRetry(page, "https://chatgpt.com/");
  const { existing, create } = await waitForProjectUi(page, name);
  if (existing) {
    const open = existing.getByRole("button", { name: /打开项目首页|Open project home/i });
    if (!(await open.count())) throw new Error(`找到了 ChatGPT 项目“${name}”，但无法打开项目首页`);
    await open.first().click();
  } else {
    await create.click();
    const input = await visibleTextInput(page);
    await input.fill(name);
    const submit = page.getByRole("button", { name: /创建项目|Create project/i });
    if (!(await submit.count())) throw new Error("未找到 ChatGPT 创建项目确认按钮");
    await submit.last().click();
  }
  await page.waitForURL((url) => Boolean(projectBaseUrl(url.href)), { timeout: 30_000 });
  await waitForComposer(page);
  const url = page.url().split("?")[0];
  const baseUrl = projectBaseUrl(url);
  if (!baseUrl) throw new Error(`ChatGPT 项目“${name}”创建或打开后无法验证项目 URL`);
  return { enabled: true, name, url: `${baseUrl}/project`, baseUrl };
}

export async function openDirectionChat(page, project, savedChatUrl = null) {
  let target = project.url;
  if (savedChatUrl) {
    const savedBase = projectBaseUrl(savedChatUrl);
    if (project.enabled && savedBase !== project.baseUrl) {
      throw new Error("已记录的 ChatGPT 方向聊天不属于当天项目，已停止以避免素材串线");
    }
    if (!project.enabled || savedBase === project.baseUrl) target = savedChatUrl;
  }
  await navigateWithRetry(page, target);
  if (project.enabled && projectBaseUrl(page.url()) !== project.baseUrl) {
    throw new Error(`未能进入 ChatGPT 项目“${project.name}”，已停止以避免创建散落聊天`);
  }
}

const attachmentRemovalSelector = [
  'button[aria-label^="移除文件"]',
  'button[aria-label^="Remove file"]',
  'button[aria-label*="移除文件"]',
  'button[aria-label*="Remove file"]'
].join(",");

export function attachmentDeliveryStatus({ files, removalLabels = [], imageCount = 0, sendEnabled = false, failureText = "" }) {
  const expectedNames = files.map((file) => path.basename(file));
  const matchedNames = expectedNames.filter((name) => removalLabels.some((label) => label.includes(name)));
  const failed = /上传失败|无法上传|文件处理失败|upload failed|could not upload|failed to upload/i.test(failureText);
  return {
    ready: !failed && matchedNames.length === expectedNames.length && imageCount >= expectedNames.length && sendEnabled,
    failed,
    expectedNames,
    matchedNames,
    imageCount,
    sendEnabled
  };
}

export function assistantReportsMissingReferenceImages(text) {
  return /(?:看不到|未看到|没有收到|无法访问|未上传|没有上传).{0,30}(?:参考图|图片|图像)|(?:reference images?|uploaded images?).{0,30}(?:missing|not (?:attached|uploaded|available)|can(?:not|'t) see|do not see|don't see)|(?:can(?:not|'t) see|do not see|don't see).{0,30}(?:reference images?|uploaded images?)/i
    .test(String(text || ""));
}

export function referenceAnalysisReceiptValid(receipt, files) {
  if (!receipt?.analysisAcceptedAt || !Array.isArray(receipt.files)) return false;
  const expected = files.map((file) => path.basename(file)).sort();
  return JSON.stringify([...receipt.files].sort()) === JSON.stringify(expected);
}

async function composerForm(page) {
  const form = page.locator('form[data-type="unified-composer"]');
  if (!(await form.count())) throw new Error("未找到 ChatGPT 统一输入区域，无法验证图片附件");
  return form.first();
}

async function clearComposerAttachments(page) {
  const form = await composerForm(page);
  for (let remaining = await form.locator(attachmentRemovalSelector).count(); remaining > 0; remaining -= 1) {
    await form.locator(attachmentRemovalSelector).first().click();
    await page.waitForTimeout(150);
  }
}

async function attachmentSnapshot(page, files) {
  const form = await composerForm(page);
  const removalLabels = await form.locator(attachmentRemovalSelector).evaluateAll((buttons) => buttons
    .map((button) => button.getAttribute("aria-label") || "")
    .filter(Boolean));
  const imageCount = await form.locator("img").evaluateAll((images) => images.filter((image) => {
    const rect = image.getBoundingClientRect();
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && rect.width >= 16 && rect.height >= 16;
  }).length);
  const sendButtons = form.locator('[data-testid="send-button"], button[aria-label*="发送"], button[aria-label*="Send"]');
  let sendEnabled = false;
  for (let index = 0; index < await sendButtons.count(); index += 1) {
    const button = sendButtons.nth(index);
    if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
      sendEnabled = true;
      break;
    }
  }
  const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  const failureText = `${await form.innerText().catch(() => "")}\n${alerts.join("\n")}`;
  return attachmentDeliveryStatus({ files, removalLabels, imageCount, sendEnabled, failureText });
}

async function attachFiles(page, files) {
  await clearComposerAttachments(page);
  let input = null;
  const inputStarted = Date.now();
  while (Date.now() - inputStarted < 30_000 && !input) {
    const candidates = [
      page.locator('input[data-testid="upload-photos-input"]'),
      page.locator("#upload-photos"),
      page.locator('input[type="file"][accept*="image"]:not([capture])')
    ];
    for (const candidate of candidates) {
      if (!(await candidate.count())) continue;
      const current = candidate.first();
      const handle = await current.elementHandle();
      await page.waitForTimeout(750);
      if (handle && await handle.evaluate((element) => element.isConnected).catch(() => false)) {
        input = current;
        break;
      }
    }
    if (!input) await page.waitForTimeout(250);
  }
  if (!input) throw new Error("未找到 ChatGPT 图片专用上传控件，已停止以避免无参考图生成");
  await input.setInputFiles(files);

  const started = Date.now();
  let latest;
  while (Date.now() - started < 60_000) {
    latest = await attachmentSnapshot(page, files);
    if (latest.failed) throw new Error(`ChatGPT 图片附件上传失败：${latest.expectedNames.join("、")}`);
    if (latest.ready) {
      await page.waitForTimeout(500);
      const stable = await attachmentSnapshot(page, files);
      if (stable.ready) return stable;
    }
    await page.waitForTimeout(500);
  }
  const missing = latest?.expectedNames?.filter((name) => !latest.matchedNames.includes(name)) || files.map(path.basename);
  throw new Error(`等待 ChatGPT 图片附件就绪超时：${missing.join("、")}`);
}

async function sendPrompt(page, prompt) {
  const box = await composer(page);
  await box.fill(prompt);
  const candidates = [
    page.locator('[data-testid="send-button"]'),
    page.locator('button[aria-label*="发送"]'),
    page.locator('button[aria-label*="Send"]'),
    page.getByRole("button", { name: /发送|Send message|Send/i })
  ];
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    for (const candidate of candidates) {
      const count = await candidate.count();
      for (let index = 0; index < count; index += 1) {
        const button = candidate.nth(index);
        if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
          await button.click();
          await page.waitForTimeout(500);
          return;
        }
      }
    }
    await page.waitForTimeout(1000);
  }
  await box.press("Enter");
  await page.waitForTimeout(1200);
  const remaining = await box.textContent().catch(() => "");
  if ((remaining || "").trim()) throw new Error("ChatGPT 提示词已填写但未能提交");
}

async function validImageFile(file) {
  try { return (await fs.stat(file)).size > 5_000; }
  catch { return false; }
}

async function waitForAssistant(page, previousCount, timeout) {
  const selector = '[data-message-author-role="assistant"]';
  await page.waitForFunction(
    ({ selector: target, previous }) => document.querySelectorAll(target).length > previous,
    { selector, previous: previousCount },
    { timeout }
  );
  const messages = page.locator(selector);
  const count = await messages.count();
  const response = messages.nth(count - 1);
  const stop = page.locator('[data-testid="stop-button"]');
  if (await stop.count()) await stop.first().waitFor({ state: "hidden", timeout }).catch(() => {});
  await response.waitFor({ state: "visible", timeout });
  return response;
}

async function sendAndRead(page, prompt, timeout) {
  const messages = page.locator('[data-message-author-role="assistant"]');
  const before = await messages.count();
  await sendPrompt(page, prompt);
  const response = await waitForAssistant(page, before, timeout);
  await page.waitForFunction(
    (selector) => (document.querySelectorAll(selector).item(document.querySelectorAll(selector).length - 1)?.textContent || "").trim().length > 20,
    '[data-message-author-role="assistant"]',
    { timeout }
  );
  return { response, text: await response.innerText() };
}

async function visibleImageSources(page) {
  return page.locator("img").evaluateAll((images) => images
    .filter((image) => {
      const rect = image.getBoundingClientRect();
      return (image.naturalWidth >= 512 && image.naturalHeight >= 512)
        || (rect.width >= 100 && rect.height >= 80);
    })
    .map((image) => image.currentSrc || image.src)
    .filter(Boolean));
}

async function waitForImageGenerationToSettle(page, timeout) {
  const stop = page.locator('[data-testid="stop-button"]');
  if (await stop.count()) {
    await stop.first().waitFor({ state: "hidden", timeout }).catch(() => {});
  }
  await page.waitForTimeout(1000);
}

async function downloadedImageIsExcluded(file, excludedFiles) {
  if (!excludedFiles.length) return false;
  const candidate = await fs.readFile(file);
  const candidateFingerprint = await sharp(candidate)
    .flatten({ background: "white" })
    .resize(16, 16, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  for (const excludedFile of excludedFiles) {
    try {
      const excluded = await fs.readFile(excludedFile);
      if (candidate.equals(excluded)) return true;
      const excludedFingerprint = await sharp(excluded)
        .flatten({ background: "white" })
        .resize(16, 16, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();
      let difference = 0;
      for (let index = 0; index < candidateFingerprint.length; index += 1) {
        difference += Math.abs(candidateFingerprint[index] - excludedFingerprint[index]);
      }
      if (difference / candidateFingerprint.length < 6) return true;
    } catch {}
  }
  return false;
}

async function acceptDownloadedImage(page, file, src, previous, excludedFiles, timeout) {
  if (await downloadedImageIsExcluded(file, excludedFiles)) {
    await fs.rm(file, { force: true });
    previous.add(src);
    return false;
  }
  await waitForImageGenerationToSettle(page, timeout);
  return true;
}

async function saveLastAssistantImage(page, file, timeout, previousSources = [], excludedFiles = []) {
  const started = Date.now();
  const previous = new Set(previousSources);
  while (Date.now() - started < timeout) {
    const pageText = await page.locator("body").innerText().catch(() => "");
    if (/图片生成失败|无法完成这张图|image generation failed|unable to (complete|generate) (this|the) image/i.test(pageText)) {
      throw new Error("ChatGPT 网页报告图片生成失败");
    }
    const sources = await visibleImageSources(page);
    const src = [...sources].reverse().find((value) => !previous.has(value));
    if (src) {
      if (src?.startsWith("data:")) {
        const base64 = src.slice(src.indexOf(",") + 1);
        await fs.writeFile(file, Buffer.from(base64, "base64"));
        if (await acceptDownloadedImage(page, file, src, previous, excludedFiles, Math.max(1000, timeout - (Date.now() - started)))) return;
        continue;
      }
      if (src?.startsWith("blob:")) {
        try {
          const base64 = await page.evaluate(async (url) => {
            const blob = await fetch(url).then((res) => res.blob());
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
          }, src);
          await fs.writeFile(file, Buffer.from(base64, "base64"));
          if (await acceptDownloadedImage(page, file, src, previous, excludedFiles, Math.max(1000, timeout - (Date.now() - started)))) return;
          continue;
        } catch {
          previous.add(src);
        }
      }
      if (src) {
        const inPage = await page.evaluate(async (url) => {
          try {
            const response = await fetch(url, { credentials: "include" });
            if (!response.ok) return { ok: false, status: response.status };
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 32_768) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
            }
            return { ok: true, base64: btoa(binary) };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        }, src);
        if (inPage.ok) {
          await fs.writeFile(file, Buffer.from(inPage.base64, "base64"));
          if (await acceptDownloadedImage(page, file, src, previous, excludedFiles, Math.max(1000, timeout - (Date.now() - started)))) return;
          continue;
        }
        try {
          const downloaded = await page.context().request.get(src, { timeout: 120_000 });
          if (downloaded.ok()) {
            await fs.writeFile(file, await downloaded.body());
            if (await acceptDownloadedImage(page, file, src, previous, excludedFiles, Math.max(1000, timeout - (Date.now() - started)))) return;
            continue;
          }
        } catch {}
      }
    }
    await page.waitForTimeout(3000);
  }
  throw new Error("等待 ChatGPT 生成图片超时");
}

export function analysisPrompt(index, type) {
  const popupRule = type === "popup"
    ? "\n\n这是弹窗方向，只分析和设计弹窗本体：弹窗卡片、卡内内容、贴附或越出卡片的主视觉、阴影、按钮及属于弹窗的装饰。不要把参考图中的 App 页面、搜索栏、导航、侧边卡片、行情面板、底部 Tab 或其他环境背景写入 composition、components 或 imagePrompt。"
    : "";
  const components = type === "popup"
    ? '["Popup Card", "Attached Hero", "Decorations", "Icon", "Title", "Subtitle", "CTA"]'
    : '["Background", "Decorations", "Icon", "Title", "Subtitle", "CTA"]';
  return `你是一名中国互联网金融运营视觉设计师。分析我上传的两张参考图，但不得复制真实品牌Logo、品牌名、原文案或完全相同版式。为第${index}套方向输出品牌中性的原创设计规格。${popupRule}\n\n只输出以下标记包裹的合法JSON，不要增加解释：\nFINANCE_SPEC_START\n{\n  "keywords": ["视觉关键词"],\n  "composition": "构图描述",\n  "palette": ["#RRGGBB"],\n  "components": ${components},\n  "typography": "字体气质",\n  "copy": {"title": "原创标题", "subtitle": "原创副标题", "cta": "按钮文案"},\n  "imagePrompt": "用于生成完整运营设计的中文提示词"\n}\nFINANCE_SPEC_END\n\n文案不得承诺必下款、百分百审批、固定收益或伪造监管背书。`;
}

export function previewPrompt(spec, width, height, type) {
  const popupRule = type === "popup"
    ? "\n\n这是一张弹窗素材，不是完整 App 页面。只生成一个完整弹窗本体，包括弹窗卡片、阴影、贴附或越出卡片的主视觉、卡内文字、图标、数据面板和按钮。弹窗外部只留均匀、干净的纯色空白安全区，不生成或暗示 App 页面、搜索栏、导航栏、底部 Tab、页面卡片、信息流、页面图表或其他界面背景，也不要用虚化页面填充弹窗后方。让弹窗主体尽量占满画布并保持完整，不要裁切。"
    : "";
  return `请根据下面的规格直接生成一张完整的中国互联网金融运营设计图，画布比例约为 ${width}:${height}。保持品牌中性，不出现任何真实公司名称、Logo、二维码、手机号或夸大审批承诺。中文文字应清晰，整体原创。${popupRule}\n\n${JSON.stringify(spec, null, 2)}`;
}

export function decompositionPrompt(index, width, height, maxAssets, type) {
  const popupRule = type === "popup"
    ? "\n\n这是弹窗方向。只输出属于弹窗本体的图层：弹窗主卡片、卡片阴影、贴附或越出卡片的主视觉、卡内面板、按钮、文字、图标和装饰。忽略弹窗外的纯色空白及任何残余页面环境，不得创建 Background/AppInterface、Page、SearchBar、Navigation、BottomTab、Feed、页面卡片或其他背景界面图层。弹窗主卡片是内容根节点，用 card/vector 表示，不要为弹窗外画布创建 background 图层。"
    : "";
  const firstLayer = type === "popup"
    ? '{"id":"modal_card","role":"Container/MainCard","kind":"card","bbox":{"x":0.16,"y":0.15,"width":0.68,"height":0.72},"editable":"vector","zIndex":10,"confidence":0.98}'
    : '{"id":"background","role":"Background","kind":"background","bbox":{"x":0,"y":0,"width":1,"height":1},"editable":"background","zIndex":0,"confidence":0.98}';
  return `分析第${index}套完整运营图（${width}x${height}），输出供 Figma 重构的图层 JSON。识别背景、卡片、按钮、文字、图标、装饰和主视觉，并为每层提供0到1的bbox、zIndex和confidence。${popupRule}\n\neditable只能是background、raster、vector或text。只有无法用 Figma 文字和基础矢量可靠重构、且必须保留原图细节的复杂主视觉、3D物体、人物、吉祥物或复杂插画才用raster，最多 ${maxAssets} 个；卡片、按钮、普通图标、图表、线条、光轨和简单装饰都用vector，文字用text。不要为了多拆图而把可重构元素标成raster。每个raster只需用assetPrompt简短指出要从原图提取的主体及其自带光影。每个普通功能图标使用kind=icon，并增加icon对象：query用2到4个简短英文词准确描述图标语义，style只可为line或fill，color使用原图十六进制颜色；不要臆造图标库文件名。\n\n只输出以下标记包裹的合法JSON，不要解释：\nDECOMPOSE_START\n{\n  "schemaVersion": 4,\n  "canvas": {"width": ${width}, "height": ${height}},\n  "layers": [\n    ${firstLayer},\n    {"id":"hero","role":"Visual/Hero","kind":"illustration","bbox":{"x":0.18,"y":0.2,"width":0.64,"height":0.45},"assetPrompt":"主视觉及其自带光影","editable":"raster","zIndex":20,"confidence":0.9},\n    {"id":"security_icon","role":"Icon/Security","kind":"icon","bbox":{"x":0.16,"y":0.58,"width":0.06,"height":0.06},"icon":{"query":"shield check","style":"line","color":"#2F6BFF"},"editable":"vector","zIndex":30,"confidence":0.9},\n    {"id":"title","role":"Copy/Title","kind":"text","bbox":{"x":0.2,"y":0.7,"width":0.6,"height":0.08},"text":"图中原文","typography":{"sizeLevel":"large","weight":"bold","color":"#000000","align":"center"},"editable":"text","zIndex":40,"confidence":0.9}\n  ]\n}\nDECOMPOSE_END\n\n不要改写文字，不要猜看不清的内容，不要输出蒙版或多边形。`;
}

export function separateAssetPrompt(layer) {
  const subject = layer.assetPrompt || layer.role || layer.id;
  return `将原图中的“${subject}”单独导出为透明背景高清 PNG，保持造型、比例、颜色、光影和细节与原图一致；不要重绘，不要其他元素、底色、色雾或棋盘格。直接生成图片。`;
}

export function separateAssetCorrectionPrompt(layer, reason) {
  return `上一张“${layer.assetPrompt || layer.role || layer.id}”不合格：${reason}。请重新从原图单独提取，保持原样，只输出真实透明背景 PNG，不要底色、棋盘格或其他元素。`;
}

export function selectReferencePair(references, type, typeIndex) {
  const typed = references.filter((item) => item.referenceType === type);
  const pool = typed.length >= 2 ? typed : references;
  if (pool.length < 2) throw new Error(`${type} 类型至少需要两张参考图`);
  return [pool[(typeIndex * 2) % pool.length], pool[(typeIndex * 2 + 1) % pool.length]];
}

export function recordDirectionFailure(manifest, failure) {
  manifest.failures = (manifest.failures || [])
    .filter((item) => item.index !== failure.index)
    .concat(failure)
    .sort((left, right) => left.index - right.index);
}

export function clearDirectionFailure(manifest, index) {
  manifest.failures = (manifest.failures || []).filter((item) => item.index !== index);
}

export function activeDirectionFailures(manifest) {
  const ready = new Set((manifest.directions || []).filter((item) => item.status === "ready").map((item) => item.index));
  return (manifest.failures || []).filter((item) => !ready.has(item.index));
}

export function requiresUserAction(error) {
  return /登录|log in|验证码|captcha|安全验证|security check|WAF|权限|permission|access denied|访问被阻止/i
    .test(String(error?.message || error));
}

export async function decomposePreview(page, config, previewFile, directionDir, index, width, height, type, onConversationReady = async () => {}) {
  const layersFile = path.join(directionDir, "layers.json");
  const outputDir = path.join(directionDir, "layers");
  const reportFile = path.join(outputDir, "decomposition-report.json");
  const cached = await readJson(layersFile);
  const cachedReport = await readJson(reportFile);
  if (cached?.schemaVersion >= 4 && cached?.layers?.length && await reportAssetsReady(cachedReport)) return cached;
  const decompositionTimeout = config.generation.decompositionTimeoutMinutes || config.generation.analysisTimeoutMinutes;
  const assetConfig = config.transparentAssets || {};
  const maxAssets = assetConfig.maxAssets ?? 4;
  await attachFiles(page, [previewFile]);
  let layers = cached?.schemaVersion >= 4 && cached?.layers?.length ? cached : null;
  if (!layers) {
    let analysis = await sendAndRead(page, decompositionPrompt(index, width, height, maxAssets, type), minuteTimeout(decompositionTimeout));
    await onConversationReady();
    if (assistantReportsMissingReferenceImages(analysis.text)) {
      throw new Error("ChatGPT 明确表示未收到完整预览图片，已停止本次拆解并等待重新上传");
    }
    const analysisFile = path.join(directionDir, "decomposition-analysis.txt");
    await fs.writeFile(analysisFile, analysis.text, "utf8");
    let parsed;
    try {
      parsed = extractMarkedJson(analysis.text, "DECOMPOSE_START", "DECOMPOSE_END");
    } catch {
      const repair = await sendAndRead(page, "上一条回复没有包含可解析的 DECOMPOSE_START / DECOMPOSE_END JSON。不要解释、不要生成图片，请严格按照上一条要求重新输出完整的标记 JSON。", minuteTimeout(decompositionTimeout));
      await onConversationReady();
      await fs.appendFile(analysisFile, `\n\n--- FORMAT_RETRY ---\n\n${repair.text}`, "utf8");
      parsed = extractMarkedJson(repair.text, "DECOMPOSE_START", "DECOMPOSE_END");
      analysis = repair;
    }
    layers = assignAssetIndices(parsed, maxAssets);
  } else {
    layers = assignAssetIndices(layers, maxAssets);
  }
  await writeJsonAtomic(layersFile, layers);
  await fs.mkdir(outputDir, { recursive: true });
  const existingFiles = await fs.readdir(outputDir, { withFileTypes: true });
  await Promise.all(existingFiles
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => fs.rm(path.join(outputDir, entry.name), { force: true })));

  const assetTimeout = minuteTimeout(assetConfig.timeoutMinutes ?? 10);
  const maxCorrectionAttempts = Math.max(0, Number(assetConfig.maxCorrectionAttempts ?? 1) || 0);
  const assetResults = new Map();
  for (const layer of layers.layers.filter(isRasterAsset).sort((left, right) => left.assetIndex - right.assetIndex)) {
    let result;
    for (let attempt = 0; attempt <= maxCorrectionAttempts; attempt += 1) {
      const candidateFile = path.join(outputDir, `.candidate-${layer.assetIndex + 1}.png`);
      const previousSources = await visibleImageSources(page);
      const prompt = attempt === 0
        ? separateAssetPrompt(layer)
        : separateAssetCorrectionPrompt(layer, result.reason);
      await sendPrompt(page, prompt);
      await saveLastAssistantImage(page, candidateFile, assetTimeout, previousSources, [previewFile]);
      await onConversationReady();
      result = await validateSeparateAsset({ candidateFile, layer, outputDir, thresholds: assetConfig });
      if (result.status === "accepted") {
        await fs.rm(candidateFile, { force: true });
        break;
      }
      await fs.rename(candidateFile, path.join(outputDir, `rejected-${String(layer.assetIndex + 1).padStart(2, "0")}-attempt-${attempt + 1}.png`));
    }
    assetResults.set(layer.id, result);
  }
  const report = await writeDecompositionReport({
    plan: layers,
    sourceImage: previewFile,
    outputDir,
    assetResults
  });
  if (report.status !== "ready") {
    throw new Error(`ChatGPT 独立透明素材未通过质量检查：${report.warnings.join("；") || "存在无效素材"}`);
  }
  return layers;
}

export async function generateDirections({
  page,
  config,
  runDir,
  references,
  count,
  directionTypes = null,
  runDate = null,
  onProjectReady = async () => {}
}) {
  await ensureChatGptLoggedIn(page);
  const directionsDir = path.join(runDir, "directions");
  await fs.mkdir(directionsDir, { recursive: true });
  const manifestFile = path.join(runDir, "figma-manifest.json");
  const manifest = await readJson(manifestFile, { date: runDate || path.basename(runDir), figma: config.figma, directions: [] });
  manifest.directionChats ||= {};
  let project = null;
  if (manifest.chatgptProject?.url) {
    project = {
      enabled: manifest.chatgptProject.enabled !== false,
      name: manifest.chatgptProject.name || dailyProjectName(config, manifest.date || path.basename(runDir)),
      url: manifest.chatgptProject.url,
      baseUrl: manifest.chatgptProject.baseUrl || projectBaseUrl(manifest.chatgptProject.url)
    };
    await onProjectReady(manifest.chatgptProject);
  }

  for (let zero = 0; zero < count; zero += 1) {
    const index = zero + 1;
    const directionDir = path.join(directionsDir, String(index).padStart(2, "0"));
    await fs.mkdir(directionDir, { recursive: true });
    const specFile = path.join(directionDir, "spec.json");
    const existing = manifest.directions.find((item) => item.index === index && item.status === "ready");
    const existingLayers = await readJson(path.join(directionDir, "layers.json"));
    const existingReport = await readJson(path.join(directionDir, "layers", "decomposition-report.json"));
    if (existing && existingLayers?.schemaVersion >= 4 && existingLayers.layers?.length && await reportAssetsReady(existingReport)) continue;
    if (!project) {
      project = await ensureDailyProject(page, config, manifest.date || path.basename(runDir));
      manifest.chatgptProject = { ...project, resolvedAt: new Date().toISOString() };
      await writeJsonAtomic(manifestFile, manifest);
      await onProjectReady(manifest.chatgptProject);
    }
    let cachedSpec = await readJson(specFile);
    const type = directionTypes?.[zero] || (index <= 6 ? "popup" : index <= 8 ? "banner" : "float");
    const typeIndex = directionTypes
      ? directionTypes.slice(0, zero).filter((candidate) => candidate === type).length
      : type === "popup" ? index - 1 : type === "banner" ? index - 7 : index - 9;
    const chatTitle = directionChatTitle(type, typeIndex);
    const pair = selectReferencePair(references, type, typeIndex);
    const referenceFiles = pair.map((item) => item.file);
    const attachmentReceiptFile = path.join(directionDir, "reference-attachments.json");
    let attachmentReceipt = await readJson(attachmentReceiptFile);
    if (cachedSpec && !referenceAnalysisReceiptValid(attachmentReceipt, referenceFiles)) cachedSpec = null;
    const size = type === "popup" ? { width: 1002, height: 1335 } : type === "banner" ? { width: 1140, height: 240 } : { width: 240, height: 240 };
    let lastError;
    const savedChat = manifest.directionChats[String(index)]?.url
      || (manifest.failures || []).find((item) => item.index === index)?.chatUrl;
    await openDirectionChat(page, project, savedChat);
    let referencesAttached = false;
    const rememberConversation = async () => {
      const url = conversationUrl(page.url());
      if (!url) return null;
      let previous = manifest.directionChats[String(index)];
      if (previous?.url !== url) {
        previous = { url, projectUrl: project.url, updatedAt: new Date().toISOString() };
        manifest.directionChats[String(index)] = previous;
        await writeJsonAtomic(manifestFile, manifest);
      }
      if (previous.title !== chatTitle) {
        await ensureDirectionChatTitle(page, project, url, chatTitle);
        manifest.directionChats[String(index)] = {
          ...manifest.directionChats[String(index)],
          title: chatTitle,
          renamedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await writeJsonAtomic(manifestFile, manifest);
      }
      return url;
    };

    for (let attempt = 0; attempt <= config.generation.maxRetries; attempt += 1) {
      try {
        if (!referencesAttached) {
          const attachment = await attachFiles(page, referenceFiles);
          attachmentReceipt = {
            files: attachment.expectedNames,
            verifiedAt: new Date().toISOString(),
            analysisAcceptedAt: null
          };
          await writeJsonAtomic(attachmentReceiptFile, attachmentReceipt);
          referencesAttached = true;
        }
        let spec = cachedSpec;
        if (!spec) {
          const analysis = await sendAndRead(page, analysisPrompt(index, type), minuteTimeout(config.generation.analysisTimeoutMinutes));
          await rememberConversation();
          if (assistantReportsMissingReferenceImages(analysis.text)) {
            referencesAttached = false;
            throw new Error("ChatGPT 明确表示未收到两张参考图，下一次尝试将重新上传");
          }
          spec = extractJson(analysis.text);
          cachedSpec = spec;
          await fs.writeFile(path.join(directionDir, "analysis.txt"), analysis.text, "utf8");
          await writeJsonAtomic(specFile, spec);
          attachmentReceipt = { ...attachmentReceipt, analysisAcceptedAt: new Date().toISOString() };
          await writeJsonAtomic(attachmentReceiptFile, attachmentReceipt);
        }

        const previewFile = path.join(directionDir, "preview.png");
        if (!(await validImageFile(previewFile))) {
          const previewImageSources = await visibleImageSources(page);
          await sendPrompt(page, previewPrompt(spec, size.width, size.height, type));
          await saveLastAssistantImage(page, previewFile, minuteTimeout(config.generation.imageTimeoutMinutes), previewImageSources, pair.map((item) => item.file));
          await rememberConversation();
        }

        const layers = await decomposePreview(page, config, previewFile, directionDir, index, size.width, size.height, type, rememberConversation);
        const chatUrl = await rememberConversation();

        const entry = {
          index, status: "ready", type, contentScope: type === "popup" ? "popup-only" : "full-canvas", ...size, previewFile,
          specFile: path.join(directionDir, "spec.json"),
          layersFile: path.join(directionDir, "layers.json"),
          decompositionReport: path.join(directionDir, "layers", "decomposition-report.json"),
          transparentAssetCount: layers.layers.filter(isRasterAsset).length,
          layerCount: Array.isArray(layers.layers) ? layers.layers.length : 0,
          sourceUrls: pair.map((item) => item.sourceUrl),
          chatUrl,
          chatTitle,
          keywords: spec.keywords || [],
          copy: spec.copy || {}
        };
        manifest.directions = manifest.directions.filter((item) => item.index !== index).concat(entry).sort((a, b) => a.index - b.index);
        clearDirectionFailure(manifest, index);
        await writeJsonAtomic(manifestFile, manifest);
        lastError = null;
        break;
      } catch (error) {
        if (requiresUserAction(error)) throw error;
        if (/参考图|图片附件|图片选择数量/.test(error.message)) referencesAttached = false;
        await rememberConversation().catch(() => {});
        lastError = error;
        console.error(`第 ${index} 套第 ${attempt + 1} 次尝试失败：${error.message}`);
        await screenshotFailure(page, path.join(directionDir, `error-attempt-${attempt + 1}.png`));
      }
    }
    if (lastError) {
      const failure = {
        index,
        type,
        attempts: config.generation.maxRetries + 1,
        message: lastError.message,
        chatUrl: manifest.directionChats[String(index)]?.url || null,
        chatTitle,
        failedAt: new Date().toISOString()
      };
      recordDirectionFailure(manifest, failure);
      await writeJsonAtomic(manifestFile, manifest);
      console.error(`第 ${index} 套连续 ${failure.attempts} 次失败，已记录并继续下一套：${failure.message}`);
    }
  }

  manifest.failures = activeDirectionFailures(manifest);
  await writeJsonAtomic(manifestFile, manifest);
  const learned = [...new Set(manifest.directions.flatMap((item) => item.keywords || []))].slice(0, 30);
  await writeJsonAtomic(path.join(config.outputRoot, "latest-keywords.json"), learned);
  return manifest;
}
