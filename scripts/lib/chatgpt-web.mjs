import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pluginRoot } from "./config.mjs";
import { readJson, writeJsonAtomic } from "./state.mjs";
import { screenshotFailure } from "./browser.mjs";

const execFileAsync = promisify(execFile);

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

async function ensureLoggedIn(page) {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText({ timeout: 20_000 });
  if (/Log in|登录|Sign up|注册/.test(body) && /登录|Log in/.test(body)) {
    throw new Error("ChatGPT 专用浏览器尚未登录，请先运行登录设置");
  }
  await composer(page);
}

async function startNewChat(page) {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await composer(page);
}

async function attachFiles(page, files) {
  let input = page.locator('input[type="file"]');
  if (!(await input.count())) {
    const attach = page.getByRole("button", { name: /attach|添加|上传|附件/i });
    if (await attach.count()) await attach.first().click();
    input = page.locator('input[type="file"]');
  }
  if (!(await input.count())) throw new Error("未找到 ChatGPT 文件上传控件");
  await input.first().setInputFiles(files);
  await page.waitForTimeout(1500);
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
    .filter((image) => image.getBoundingClientRect().width >= 180 && image.getBoundingClientRect().height >= 120)
    .map((image) => image.currentSrc || image.src)
    .filter(Boolean));
}

async function saveLastAssistantImage(page, file, timeout, previousSources = []) {
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
        return;
      }
      if (src?.startsWith("blob:")) {
        const base64 = await page.evaluate(async (url) => {
          const blob = await fetch(url).then((res) => res.blob());
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          return btoa(binary);
        }, src);
        await fs.writeFile(file, Buffer.from(base64, "base64"));
        return;
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
          return;
        }
        try {
          const downloaded = await page.context().request.get(src, { timeout: 120_000 });
          if (downloaded.ok()) {
            await fs.writeFile(file, await downloaded.body());
            return;
          }
        } catch {}
      }
    }
    await page.waitForTimeout(3000);
  }
  throw new Error("等待 ChatGPT 生成图片超时");
}

function analysisPrompt(index) {
  return `你是一名中国互联网金融运营视觉设计师。分析我上传的两张参考图，但不得复制真实品牌Logo、品牌名、原文案或完全相同版式。为第${index}套方向输出品牌中性的原创设计规格。\n\n只输出以下标记包裹的合法JSON，不要增加解释：\nFINANCE_SPEC_START\n{\n  "keywords": ["视觉关键词"],\n  "composition": "构图描述",\n  "palette": ["#RRGGBB"],\n  "components": ["Background", "Decorations", "Icon", "Title", "Subtitle", "CTA"],\n  "typography": "字体气质",\n  "copy": {"title": "原创标题", "subtitle": "原创副标题", "cta": "按钮文案"},\n  "imagePrompt": "用于生成完整运营设计的中文提示词"\n}\nFINANCE_SPEC_END\n\n文案不得承诺必下款、百分百审批、固定收益或伪造监管背书。`;
}

function previewPrompt(spec, width, height) {
  return `请根据下面的规格直接生成一张完整的中国互联网金融运营设计图，画布比例约为 ${width}:${height}。保持品牌中性，不出现任何真实公司名称、Logo、二维码、手机号或夸大审批承诺。中文文字应清晰，整体原创。\n\n${JSON.stringify(spec, null, 2)}`;
}

function decompositionPrompt(index, width, height) {
  return `你是一名负责UI拆图和审图的视觉分析师。下面上传的是刚生成的第${index}套完整运营设计图，画布为 ${width}x${height}。请只分析这张图，不要生成新图片。目标是把它拆成可在Figma中重组的图层计划。\n\n识别背景、卡片、主视觉素材、插画、角标、徽章、Icon、装饰、按钮和所有可编辑文字。每个图层输出归一化0到1的bbox（x,y,width,height）。对非矩形素材尽量给出归一化polygon mask points；无法确定轮廓时将 mask 留空，并在 confidence 中降低。文字必须输出原文、字体气质、字号相对等级、颜色、对齐和安全的背景修复颜色；如果文字背后有渐变、纹理或复杂素材，repair.type 必须是 none。\n\n只输出以下标记包裹的合法JSON，不要解释：\nDECOMPOSE_START\n{\n  "schemaVersion": 1,\n  "canvas": {"width": ${width}, "height": ${height}},\n  "layers": [\n    {\n      "id": "background",\n      "role": "Background",\n      "kind": "background",\n      "bbox": {"x": 0, "y": 0, "width": 1, "height": 1},\n      "editable": "raster",\n      "confidence": 0.98\n    },\n    {\n      "id": "title",\n      "role": "Copy/Title",\n      "kind": "text",\n      "bbox": {"x": 0.2, "y": 0.4, "width": 0.6, "height": 0.08},\n      "text": "图中原文",\n      "typography": {"sizeLevel": "large", "weight": "bold", "color": "#000000", "align": "center"},\n      "repair": {"type": "solid", "color": "#FFFFFF"},\n      "editable": "text",\n      "confidence": 0.9\n    }\n  ]\n}\nDECOMPOSE_END\n\n不要改写图中文字，不要补充看不清的文案，不要把一整张图标成单一插画层。`;
}

async function decomposePreview(page, config, previewFile, directionDir, index, width, height) {
  const layersFile = path.join(directionDir, "layers.json");
  const cached = await readJson(layersFile);
  if (cached?.layers?.length) return cached;
  await startNewChat(page);
  await attachFiles(page, [previewFile]);
  const decompositionTimeout = config.generation.decompositionTimeoutMinutes || config.generation.analysisTimeoutMinutes;
  const analysis = await sendAndRead(page, decompositionPrompt(index, width, height), minuteTimeout(decompositionTimeout));
  const layers = extractMarkedJson(analysis.text, "DECOMPOSE_START", "DECOMPOSE_END");
  await fs.writeFile(path.join(directionDir, "decomposition-analysis.txt"), analysis.text, "utf8");
  await writeJsonAtomic(layersFile, layers);
  await execFileAsync(process.execPath, [path.join(pluginRoot, "scripts", "decompose-image.mjs"), "--image", previewFile, "--layers", layersFile, "--out", path.join(directionDir, "layers")], { timeout: minuteTimeout(decompositionTimeout) });
  return layers;
}

export async function generateDirections({ page, config, runDir, references, count }) {
  await ensureLoggedIn(page);
  const directionsDir = path.join(runDir, "directions");
  await fs.mkdir(directionsDir, { recursive: true });
  const manifestFile = path.join(runDir, "figma-manifest.json");
  const manifest = await readJson(manifestFile, { date: path.basename(runDir), figma: config.figma, directions: [] });

  for (let zero = 0; zero < count; zero += 1) {
    const index = zero + 1;
    const directionDir = path.join(directionsDir, String(index).padStart(2, "0"));
    await fs.mkdir(directionDir, { recursive: true });
    const specFile = path.join(directionDir, "spec.json");
    const existing = manifest.directions.find((item) => item.index === index && item.status === "ready");
    if (existing && (await readJson(path.join(directionDir, "layers.json")))?.layers?.length) continue;
    let cachedSpec = await readJson(specFile);
    const pair = [references[(zero * 2) % references.length], references[(zero * 2 + 1) % references.length]];
    const type = index <= 6 ? "popup" : index <= 8 ? "banner" : "float";
    const size = type === "popup" ? { width: 1002, height: 1335 } : type === "banner" ? { width: 1140, height: 240 } : { width: 240, height: 240 };
    let lastError;

    for (let attempt = 0; attempt <= config.generation.maxRetries; attempt += 1) {
      try {
        await startNewChat(page);
        await attachFiles(page, pair.map((item) => item.file));
        let spec = cachedSpec;
        if (!spec) {
          const analysis = await sendAndRead(page, analysisPrompt(index), minuteTimeout(config.generation.analysisTimeoutMinutes));
          spec = extractJson(analysis.text);
          cachedSpec = spec;
          await fs.writeFile(path.join(directionDir, "analysis.txt"), analysis.text, "utf8");
          await writeJsonAtomic(specFile, spec);
        }

        const previewFile = path.join(directionDir, "preview.png");
        if (!(await validImageFile(previewFile))) {
          const previewImageSources = await visibleImageSources(page);
          await sendPrompt(page, previewPrompt(spec, size.width, size.height));
          await saveLastAssistantImage(page, previewFile, minuteTimeout(config.generation.imageTimeoutMinutes), previewImageSources);
        }

        const layers = await decomposePreview(page, config, previewFile, directionDir, index, size.width, size.height);

        const entry = {
          index, status: "ready", type, ...size, previewFile,
          specFile: path.join(directionDir, "spec.json"),
          layersFile: path.join(directionDir, "layers.json"),
          decompositionReport: path.join(directionDir, "layers", "decomposition-report.json"),
          layerCount: Array.isArray(layers.layers) ? layers.layers.length : 0,
          sourceUrls: pair.map((item) => item.sourceUrl),
          keywords: spec.keywords || [],
          copy: spec.copy || {}
        };
        manifest.directions = manifest.directions.filter((item) => item.index !== index).concat(entry).sort((a, b) => a.index - b.index);
        await writeJsonAtomic(manifestFile, manifest);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        console.error(`第 ${index} 套第 ${attempt + 1} 次尝试失败：${error.message}`);
        await screenshotFailure(page, path.join(directionDir, `error-attempt-${attempt + 1}.png`));
      }
    }
    if (lastError) throw new Error(`第 ${index} 套生成失败：${lastError.message}`);
  }

  const learned = [...new Set(manifest.directions.flatMap((item) => item.keywords || []))].slice(0, 30);
  await writeJsonAtomic(path.join(config.outputRoot, "latest-keywords.json"), learned);
  return manifest;
}
