import path from "node:path";
import { appSupportDir, ensureConfig, localDate } from "./lib/config.mjs";
import { readJson, writeJsonAtomic } from "./lib/state.mjs";
import { notify } from "./lib/notify.mjs";

const config = await ensureConfig();
const now = new Date();
const date = localDate(config.timezone, now);
const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: config.timezone,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
}).format(now);

if (time < "10:30") {
  console.log("NO_ACTION");
  process.exit(0);
}

const run = await readJson(path.join(config.outputRoot, date, "run.json"));
if (run && ["running", "awaiting_figma", "complete"].includes(run.status)) {
  console.log("NO_ACTION");
  process.exit(0);
}

const reminderFile = path.join(appSupportDir, "missed-reminders.json");
const reminders = await readJson(reminderFile, {});
if (reminders[date]) {
  console.log("NO_ACTION");
  process.exit(0);
}

reminders[date] = new Date().toISOString();
await writeJsonAtomic(reminderFile, reminders);
await notify("金融运营素材流水线", "今天10:30的任务未执行。需要你确认后再补跑。");
console.log(JSON.stringify({ status: "MISSED_RUN", date, message: "今天10:30的素材任务未执行，等待用户确认补跑。" }));
