import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ensureConfig } from "./lib/config.mjs";
import { launchPersistentBrowser } from "./lib/browser.mjs";
import { ensureChatGptLoggedIn } from "./lib/chatgpt-web.mjs";

const config = await ensureConfig();
const context = await launchPersistentBrowser(config, { forceVisible: true });
const huaban = await context.newPage();
const chatgpt = await context.newPage();
await Promise.all([
  huaban.goto("https://huaban.com/discovery", { waitUntil: "domcontentloaded", timeout: 60_000 }),
  chatgpt.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60_000 })
]);

const rl = readline.createInterface({ input, output });
while (true) {
  await rl.question("请在打开的专用 Chrome 窗口中完成花瓣和 ChatGPT 登录。完成后回到这里按回车：");
  try {
    await ensureChatGptLoggedIn(chatgpt);
    break;
  } catch (error) {
    console.log(`ChatGPT 登录尚未通过验证：${error.message}`);
    console.log("请切换到专用 Chrome 的 ChatGPT 标签页完成登录，确认页面不再显示“登录”按钮后重试。");
  }
}
rl.close();
await context.close();
console.log("登录配置已保存。可以运行 npm run test-run 进行小规模试跑。");
