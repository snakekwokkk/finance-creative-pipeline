import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function readLock(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function acquireWorkflowLock(
  file,
  metadata = {},
  { pid = process.pid, processAlive = isProcessAlive } = {}
) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const token = randomUUID();
  const record = { pid, token, startedAt: new Date().toISOString(), ...metadata };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(file, "wx");
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      let released = false;
      return {
        record,
        async release() {
          if (released) return;
          released = true;
          await handle.close().catch(() => {});
          const current = await readLock(file);
          if (current?.token === token) await fs.unlink(file).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
      const existing = await readLock(file);
      if (existing && processAlive(existing.pid)) {
        const locked = new Error(`已有金融素材工作流正在运行（PID ${existing.pid}），本次不会再次启动 Chrome`);
        locked.code = "WORKFLOW_ALREADY_RUNNING";
        locked.lock = existing;
        throw locked;
      }
      await fs.unlink(file).catch((unlinkError) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new Error("无法取得金融素材工作流单实例锁");
}
