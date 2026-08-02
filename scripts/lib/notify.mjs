import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function notify(title, message) {
  const safeTitle = String(title).replaceAll('"', "'");
  const safeMessage = String(message).replaceAll('"', "'");
  try { await execFileAsync("osascript", ["-e", `display notification "${safeMessage}" with title "${safeTitle}"`]); } catch {}
}
