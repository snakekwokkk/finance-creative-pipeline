import fs from "node:fs/promises";
import { chromium } from "playwright-core";

export function shouldRunHeadless(config, { forceVisible = false } = {}) {
  if (forceVisible) return false;
  return config.browser?.headless !== false;
}

export async function launchPersistentBrowser(config, options = {}) {
  await fs.mkdir(config.profileDirectory, { recursive: true });
  return chromium.launchPersistentContext(config.profileDirectory, {
    executablePath: config.chromeExecutable,
    headless: shouldRunHeadless(config, options),
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    locale: "zh-CN",
    timezoneId: config.timezone,
    args: ["--disable-blink-features=AutomationControlled"]
  });
}

export async function findOrOpenPage(context, urlPrefix, targetUrl) {
  const existing = context.pages().find((page) => page.url().startsWith(urlPrefix));
  const page = existing || (await context.newPage());
  if (!page.url().startsWith(urlPrefix)) await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return page;
}

export async function screenshotFailure(page, file) {
  try { await page.screenshot({ path: file, fullPage: false }); } catch {}
}
