import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ensureConfig } from "./lib/config.mjs";
import { launchPersistentBrowser } from "./lib/browser.mjs";

const config = await ensureConfig();
const context = await launchPersistentBrowser(config);
const huaban = await context.newPage();
const chatgpt = await context.newPage();
await Promise.all([
  huaban.goto("https://huaban.com/discovery", { waitUntil: "domcontentloaded", timeout: 60_000 }),
  chatgpt.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60_000 })
]);

const rl = readline.createInterface({ input, output });
await rl.question("请在打开的专用 Chrome 窗口中完成花瓣和 ChatGPT 登录。完成后回到这里按回车：");
rl.close();
await context.close();
console.log("登录配置已保存。可以运行 npm run test-run 进行小规模试跑。");
