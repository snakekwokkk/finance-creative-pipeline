import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const execFileAsync = promisify(execFile);
const supportedModes = new Set(["background", "headless", "visible"]);
const chromeArgs = [
  "--disable-blink-features=AutomationControlled",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding"
];

export function browserLaunchMode(config, { forceVisible = false } = {}) {
  if (forceVisible) return "visible";
  const configured = String(config.browser?.mode || "").toLowerCase();
  if (supportedModes.has(configured)) return configured;
  if (typeof config.browser?.headless === "boolean") return config.browser.headless ? "headless" : "visible";
  return "visible";
}

export function shouldRunHeadless(config, { forceVisible = false } = {}) {
  return browserLaunchMode(config, { forceVisible }) === "headless";
}

export function createSingleLaunchBrowser(launch = launchPersistentBrowser) {
  let launchAttempted = false;
  return async (...args) => {
    if (launchAttempted) {
      const error = new Error("当前工作流已经启动过 Chrome，禁止再次打开浏览器窗口");
      error.code = "BROWSER_ALREADY_LAUNCHED";
      throw error;
    }
    launchAttempted = true;
    return launch(...args);
  };
}

export function chromeAppPath(executablePath) {
  const marker = String(executablePath || "").indexOf(".app/");
  return marker >= 0 ? executablePath.slice(0, marker + 4) : null;
}

export function parseDevToolsActivePort(value) {
  const [portLine] = String(value || "").trim().split(/\r?\n/);
  const port = Number(portLine);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

async function waitForDevToolsPort(profileDirectory, timeout = 20_000) {
  const file = path.join(profileDirectory, "DevToolsActivePort");
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const port = parseDevToolsActivePort(await fs.readFile(file, "utf8"));
      if (port) return port;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("后台 Chrome 启动超时，未获得本地调试端口");
}

async function minimizeDedicatedWindow(context, targetPage = null) {
  const page = targetPage || context.pages()[0] || await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } finally {
    await session.detach().catch(() => {});
  }
}

function keepDedicatedWindowMinimized(context) {
  const timers = new WeakMap();
  const schedule = (page) => {
    const previous = timers.get(page);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      timers.delete(page);
      minimizeDedicatedWindow(context, page).catch(() => {});
    }, 150);
    timers.set(page, timer);
  };
  const watch = (page) => {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) schedule(page);
    });
    page.on("domcontentloaded", () => schedule(page));
    schedule(page);
  };
  for (const page of context.pages()) watch(page);
  context.on("page", watch);
}

async function launchBackgroundChrome(config) {
  if (process.platform !== "darwin") throw new Error("Chrome 后台最小化模式目前仅支持 macOS");
  const appPath = chromeAppPath(config.chromeExecutable);
  if (!appPath) throw new Error("无法从 chromeExecutable 识别 macOS Chrome 应用路径");
  const activePortFile = path.join(config.profileDirectory, "DevToolsActivePort");
  await fs.unlink(activePortFile).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await execFileAsync("/usr/bin/open", [
    "-g", "-n", "-a", appPath, "--args",
    `--user-data-dir=${config.profileDirectory}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--start-minimized",
    "--window-size=1440,1000",
    "--lang=zh-CN",
    ...chromeArgs,
    "about:blank"
  ]);
  const port = await waitForDevToolsPort(config.profileDirectory);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20_000 });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error("后台 Chrome 未提供可用的持久化浏览器上下文");
  }
  keepDedicatedWindowMinimized(context);
  await minimizeDedicatedWindow(context);
  let closed = false;
  context.close = async () => {
    if (closed) return;
    closed = true;
    try {
      const session = await browser.newBrowserCDPSession();
      await session.send("Browser.close");
      await session.detach().catch(() => {});
    } catch {
      await browser.close().catch(() => {});
    }
  };
  return context;
}

export async function launchPersistentBrowser(config, options = {}) {
  await fs.mkdir(config.profileDirectory, { recursive: true });
  const mode = browserLaunchMode(config, options);
  if (mode === "background") return launchBackgroundChrome(config);
  return chromium.launchPersistentContext(config.profileDirectory, {
    executablePath: config.chromeExecutable,
    headless: mode === "headless",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    locale: "zh-CN",
    timezoneId: config.timezone,
    args: chromeArgs
  });
}

export async function findOrOpenPage(context, urlPrefix, targetUrl) {
  const existing = context.pages().find((page) => page.url().startsWith(urlPrefix));
  const reusable = context.pages().find((page) => ["about:blank", "chrome://newtab/"].includes(page.url()));
  const page = existing || reusable || (await context.newPage());
  if (!page.url().startsWith(urlPrefix)) await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return page;
}

export async function screenshotFailure(page, file) {
  try { await page.screenshot({ path: file, fullPage: false }); } catch {}
}
