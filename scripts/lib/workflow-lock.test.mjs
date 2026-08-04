import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireWorkflowLock } from "./workflow-lock.mjs";

test("a second workflow cannot launch while the first process owns the lock", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-workflow-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "workflow.lock");
  const first = await acquireWorkflowLock(file, { runName: "first" }, { pid: 101, processAlive: (pid) => pid === 101 });
  await assert.rejects(
    acquireWorkflowLock(file, { runName: "second" }, { pid: 202, processAlive: (pid) => pid === 101 }),
    (error) => error.code === "WORKFLOW_ALREADY_RUNNING"
  );
  await first.release();
});

test("a stale workflow lock is replaced and released cleanly", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-workflow-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "workflow.lock");
  await fs.writeFile(file, JSON.stringify({ pid: 303, token: "stale" }), "utf8");
  const lock = await acquireWorkflowLock(file, { runName: "replacement" }, { pid: 404, processAlive: () => false });
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.pid, 404);
  assert.equal(saved.runName, "replacement");
  await lock.release();
  await assert.rejects(fs.access(file), (error) => error.code === "ENOENT");
});
