import assert from "node:assert/strict";
import test from "node:test";
import {
  browserLaunchMode,
  chromeAppPath,
  createSingleLaunchBrowser,
  findOrOpenPage,
  parseDevToolsActivePort,
  shouldRunHeadless
} from "./browser.mjs";

test("normal pipeline runs use a visible Chrome by default", () => {
  assert.equal(browserLaunchMode({}), "visible");
  assert.equal(browserLaunchMode({ browser: { mode: "background" } }), "background");
  assert.equal(shouldRunHeadless({}), false);
});

test("legacy headless settings and explicit modes remain supported", () => {
  assert.equal(browserLaunchMode({ browser: { headless: true } }), "headless");
  assert.equal(shouldRunHeadless({ browser: { headless: true } }), true);
  assert.equal(browserLaunchMode({ browser: { headless: false } }), "visible");
  assert.equal(browserLaunchMode({ browser: { mode: "headless", headless: false } }), "headless");
});

test("login and explicit debugging can force a visible browser", () => {
  assert.equal(browserLaunchMode({}, { forceVisible: true }), "visible");
  assert.equal(shouldRunHeadless({}, { forceVisible: true }), false);
  assert.equal(shouldRunHeadless({ browser: { headless: true } }, { forceVisible: true }), false);
});

test("macOS Chrome paths and DevTools ports are parsed safely", () => {
  assert.equal(chromeAppPath("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "/Applications/Google Chrome.app");
  assert.equal(chromeAppPath("/usr/bin/chromium"), null);
  assert.equal(parseDevToolsActivePort("9222\n/devtools/browser/id\n"), 9222);
  assert.equal(parseDevToolsActivePort("invalid"), null);
});

test("one workflow process can launch Chrome only once", async () => {
  let calls = 0;
  const launch = createSingleLaunchBrowser(async () => ({ id: ++calls }));
  assert.deepEqual(await launch(), { id: 1 });
  await assert.rejects(launch(), (error) => error.code === "BROWSER_ALREADY_LAUNCHED");
  assert.equal(calls, 1);
});

test("workflow pages reuse an existing blank tab before opening another tab", async () => {
  let currentUrl = "about:blank";
  const blankPage = {
    url: () => currentUrl,
    goto: async (url) => { currentUrl = url; }
  };
  const context = {
    pages: () => [blankPage],
    newPage: async () => { throw new Error("should reuse blank page"); }
  };
  assert.equal(await findOrOpenPage(context, "https://huaban.com", "https://huaban.com/discovery"), blankPage);
  assert.equal(currentUrl, "https://huaban.com/discovery");
});
