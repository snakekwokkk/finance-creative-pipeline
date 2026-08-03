import fs from "node:fs/promises";
import path from "node:path";
import { appSupportDir, ensureConfig, localDate, localTime } from "./lib/config.mjs";
import { launchPersistentBrowser, findOrOpenPage, screenshotFailure } from "./lib/browser.mjs";
import { collectReferences } from "./lib/collector.mjs";
import { activeDirectionFailures, generateDirections } from "./lib/chatgpt-web.mjs";
import { appendError, ensureRun, readJson, updateRun, writeJsonAtomic } from "./lib/state.mjs";
import { notify } from "./lib/notify.mjs";

const testMode = process.argv.includes("--test");
const scheduledMode = process.argv.includes("--scheduled");
const config = await ensureConfig();
await fs.mkdir(config.outputRoot, { recursive: true });
const date = localDate(config.timezone);
const runDir = path.join(config.outputRoot, date);
const runFile = path.join(runDir, "run.json");
await fs.mkdir(runDir, { recursive: true });

const existingRun = await readJson(runFile);
if (scheduledMode && localTime(config.timezone) > "10:45" && !existingRun) {
  const reminderFile = path.join(appSupportDir, "missed-reminders.json");
  const reminders = await readJson(reminderFile, {});
  if (!reminders[date]) {
    reminders[date] = new Date().toISOString();
    await writeJsonAtomic(reminderFile, reminders);
    await notify("金融运营素材流水线", "今天10:30的任务未执行。需要你确认后再补跑。");
  }
  console.log(JSON.stringify({ status: "MISSED_RUN", date, message: "等待用户确认补跑" }));
  process.exit(0);
}
await ensureRun(runFile, date, testMode);

const referenceCount = testMode ? 3 : config.collection.referenceCount;
const directionCount = testMode ? 1 : config.generation.directionCount;
let context;
try {
  context = await launchPersistentBrowser(config);
  const huaban = await findOrOpenPage(context, "https://huaban.com", "https://huaban.com/discovery");
  const chatgpt = await findOrOpenPage(context, "https://chatgpt.com", "https://chatgpt.com/");

  await updateRun(runFile, { status: "running", stages: { collection: "running", generation: "pending", decomposition: "pending", figma: "pending" } });
  const references = await collectReferences({ context, page: huaban, config, runDir, date, count: referenceCount });
  await updateRun(runFile, { status: "running", referenceCount: references.length, stages: { collection: "complete", generation: "running", decomposition: "pending", figma: "pending" } });
  const manifest = await generateDirections({ page: chatgpt, config, runDir, references, count: directionCount });
  const readyCount = manifest.directions.filter((item) => item.status === "ready").length;
  const failures = activeDirectionFailures(manifest);
  const manifestFile = path.join(runDir, "figma-manifest.json");
  if (failures.length) {
    await updateRun(runFile, {
      status: "blocked",
      directionCount: readyCount,
      directionFailures: failures,
      figmaManifest: manifestFile,
      stages: { collection: "complete", generation: "partial", decomposition: "partial", figma: "pending" }
    });
    await notify("金融运营素材流水线部分完成", `${readyCount}/${directionCount} 套已完成，${failures.length} 套失败；再次运行将只重试失败方向。`);
    console.log(JSON.stringify({ status: "partial", runDir, manifest: manifestFile, readyCount, failures }));
    process.exitCode = 1;
  } else {
    await updateRun(runFile, {
      status: "awaiting_figma",
      directionCount: readyCount,
      directionFailures: [],
      figmaManifest: manifestFile,
      stages: { collection: "complete", generation: "complete", decomposition: "complete", figma: "pending" }
    });
    await notify("金融运营素材流水线", `本地素材和生图已完成，等待写入 Figma：${runDir}`);
    console.log(JSON.stringify({ status: "awaiting_figma", runDir, manifest: manifestFile }));
  }
} catch (error) {
  if (context?.pages()?.length) await screenshotFailure(context.pages()[0], path.join(runDir, "fatal-error.png"));
  await appendError(runFile, "local_pipeline", error);
  await notify("金融运营素材流水线需要处理", error.message);
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
}
