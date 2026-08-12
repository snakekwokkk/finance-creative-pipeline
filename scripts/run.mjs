import fs from "node:fs/promises";
import path from "node:path";
import { appSupportDir, ensureConfig, localDate, localTime } from "./lib/config.mjs";
import { createSingleLaunchBrowser, launchPersistentBrowser, findOrOpenPage, screenshotFailure } from "./lib/browser.mjs";
import { buildSearchPlansForTypes, collectReferences } from "./lib/collector.mjs";
import {
  activeDirectionFailures,
  ensureChatGptLoggedIn,
  ensureDailyProject,
  generateDirections,
  reopenDailyProject,
  readyDirectionsForFigma,
  reviewReferenceCandidates,
  workflowAbortedError,
  workflowAbortRequested
} from "./lib/chatgpt-web.mjs";
import { appendError, ensureRun, readJson, updateRun, writeJsonAtomic } from "./lib/state.mjs";
import { notify } from "./lib/notify.mjs";
import { acquireWorkflowLock } from "./lib/workflow-lock.mjs";
import { directionArtifactRevision } from "./lib/figma-sync-state.mjs";
import { directionCooldownWindow, waitForDirectionBarrier } from "./lib/direction-barrier.mjs";

const testMode = process.argv.includes("--test");
const scheduledMode = process.argv.includes("--scheduled");
const visibleMode = process.argv.includes("--visible");
const collectionOnly = process.argv.includes("--collection-only");
if (process.argv.includes("--source")) throw new Error("采图来源固定为花瓣，不再支持 --source 参数");
const typesIndex = process.argv.indexOf("--types");
const requestedTypes = typesIndex >= 0
  ? String(process.argv[typesIndex + 1] || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
  : [];
const allowedTypes = new Set(["popup", "banner", "float"]);
if (requestedTypes.some((type) => !allowedTypes.has(type))) {
  throw new Error("--types 只支持 popup、banner、float，并使用逗号分隔");
}
if (collectionOnly && requestedTypes.length === 0) {
  throw new Error("--collection-only 必须与 --types 一起使用，避免误停正式流水线");
}
const validationMode = requestedTypes.length > 0;
const config = await ensureConfig();
const sourceProvider = "huaban";
await fs.mkdir(config.outputRoot, { recursive: true });
const date = localDate(config.timezone);
const runName = validationMode
  ? `${date}-validation-${requestedTypes.join("-")}${collectionOnly ? "-collection" : ""}`
  : date;
const runDir = path.join(config.outputRoot, runName);
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
await ensureRun(runFile, date, testMode || validationMode);

const referenceCount = validationMode ? requestedTypes.length : testMode ? 1 : config.collection.referenceCount;
const directionCount = validationMode ? requestedTypes.length : testMode ? 1 : config.generation.directionCount;
const validationSearchPlans = validationMode
  ? buildSearchPlansForTypes(config.collection, requestedTypes, 1, sourceProvider)
  : null;
const runConfig = validationMode
  ? {
      ...config,
      collection: {
        ...config.collection,
        source: sourceProvider,
        searchPlans: validationSearchPlans
      },
      generation: { ...config.generation, directionCount }
    }
  : { ...config, collection: { ...config.collection, source: sourceProvider } };
let workflowLock;
try {
  workflowLock = await acquireWorkflowLock(path.join(appSupportDir, "workflow.lock"), {
    runName,
    runDir,
    mode: collectionOnly ? "collection-only" : validationMode ? "validation" : testMode ? "test" : scheduledMode ? "scheduled" : "normal",
    sourceProvider
  });
} catch (error) {
  await notify("金融运营素材流水线未启动", error.message);
  console.error(error.stack || error.message);
  process.exit(1);
}

const launchBrowserOnce = createSingleLaunchBrowser(launchPersistentBrowser);
let context;
let chatgpt;
let stopSignal = null;
const requestStop = (signal) => {
  if (stopSignal) return;
  stopSignal = signal;
  context?.close().catch(() => {});
};
const onSigint = () => requestStop("SIGINT");
const onSigterm = () => requestStop("SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);
try {
  context = await launchBrowserOnce(runConfig, { forceVisible: visibleMode });
  if (stopSignal) {
    await context.close().catch(() => {});
    throw workflowAbortedError();
  }
  const sourceHome = "https://huaban.com/discovery";
  const sourcePrefix = "https://huaban.com";
  const sourcePage = await findOrOpenPage(context, sourcePrefix, sourceHome);
  chatgpt = await findOrOpenPage(context, "https://chatgpt.com", "https://chatgpt.com/");
  const sourceDetail = await context.newPage();
  const browserSession = {
    pid: process.pid,
    launchCount: 1,
    windowCount: 1,
    sourceProvider,
    startedAt: new Date().toISOString()
  };
  console.log(JSON.stringify({ event: "browser_session_started", ...browserSession }));

  await updateRun(runFile, { status: "running", blocker: null, browserSession, stages: { collection: "running", generation: "pending", decomposition: "pending", figma: "pending" } });
  await ensureChatGptLoggedIn(chatgpt);
  const dailyProject = existingRun?.chatgptProject?.url
    ? await reopenDailyProject(chatgpt, runConfig, date, existingRun.chatgptProject)
    : await ensureDailyProject(chatgpt, runConfig, date);
  const chatgptProject = { ...dailyProject, resolvedAt: new Date().toISOString() };
  await updateRun(runFile, { chatgptProject });
  const references = await collectReferences({
    context,
    page: sourcePage,
    detailPage: sourceDetail,
    config: runConfig,
    runDir,
    date,
    count: referenceCount,
    visualReviewer: ({ type, candidates }) => reviewReferenceCandidates({
      page: chatgpt,
      project: dailyProject,
      config: runConfig,
      runDir,
      type,
      candidates
    })
  });
  if (collectionOnly) {
    const collectionSucceeded = references.length >= referenceCount;
    const status = collectionSucceeded ? "collection_complete" : "collection_incomplete";
    await updateRun(runFile, {
      status,
      blocker: null,
      referenceCount: references.length,
      chatgptProject,
      stages: {
        collection: collectionSucceeded ? "complete" : "partial",
        generation: "pending",
        decomposition: "pending",
        figma: "pending"
      }
    });
    const message = collectionSucceeded
      ? `参考图采集完成：${references.length}/${referenceCount}，已按要求停止后续流程。`
      : `参考图仅采集到 ${references.length}/${referenceCount}，未进入生图、拆图或 Figma。`;
    await notify("金融运营素材采集测试", message);
    console.log(JSON.stringify({ status, runDir, referenceCount: references.length, requestedCount: referenceCount }));
  } else {
    const figmaSyncState = path.join(runDir, "figma-sync-state.json");
    await updateRun(runFile, {
      status: "running",
      referenceCount: references.length,
      figmaSyncState,
      stages: { collection: "complete", generation: "running", decomposition: "running", figma: "pending" }
    });
    const manifest = await generateDirections({
    page: chatgpt,
    config: runConfig,
    runDir,
    references,
    count: directionCount,
    directionTypes: validationMode ? requestedTypes : null,
    runDate: date,
    initialProject: dailyProject,
    onProjectReady: (chatgptProject) => updateRun(runFile, { chatgptProject }),
    onDirectionReady: async ({ direction, manifestFile, readyCount }) => {
      const revision = await directionArtifactRevision(direction);
      const cooldown = directionCooldownWindow(
        direction.decompositionCompletedAt,
        runConfig.generation.directionCooldownMinutes
      );
      await updateRun(runFile, {
        readyDirectionCount: readyCount,
        figmaManifest: manifestFile,
        figmaSyncState,
        activeDirection: {
          index: direction.index,
          type: direction.type,
          stage: "awaiting_figma_and_cooldown",
          decompositionCompletedAt: cooldown.startedAt,
          cooldownUntil: cooldown.until,
          revision
        }
      });
      console.log(JSON.stringify({
        event: "direction_ready",
        runDir,
        manifest: manifestFile,
        figmaSyncState,
        direction: { index: direction.index, type: direction.type, status: direction.status },
        readyCount,
        decompositionCompletedAt: cooldown.startedAt,
        cooldownUntil: cooldown.until
      }));
      await waitForDirectionBarrier({
        stateFile: figmaSyncState,
        directionIndex: direction.index,
        revision,
        cooldownUntil: cooldown.until,
        pollIntervalMs: Number(runConfig.generation.figmaCompletionPollIntervalSeconds || 2) * 1_000,
        shouldStop: () => Boolean(stopSignal) || chatgpt?.isClosed(),
        onSnapshot: async (snapshot) => {
          await updateRun(runFile, {
            activeDirection: {
              index: direction.index,
              type: direction.type,
              stage: snapshot.complete
                ? "closed"
                : snapshot.cooldownComplete
                  ? "awaiting_figma"
                  : snapshot.figmaComplete
                    ? "cooldown"
                    : "awaiting_figma_and_cooldown",
              decompositionCompletedAt: cooldown.startedAt,
              cooldownUntil: cooldown.until,
              cooldownComplete: snapshot.cooldownComplete,
              figmaComplete: snapshot.figmaComplete,
              figmaStatus: snapshot.figmaStatus,
              revision
            }
          });
          console.log(JSON.stringify({
            event: "direction_barrier",
            direction: direction.index,
            cooldownUntil: cooldown.until,
            ...snapshot
          }));
        }
      });
      await updateRun(runFile, {
        activeDirection: {
          index: direction.index,
          type: direction.type,
          stage: "closed",
          decompositionCompletedAt: cooldown.startedAt,
          cooldownUntil: cooldown.until,
          closedAt: new Date().toISOString(),
          revision
        }
      });
      console.log(JSON.stringify({ event: "direction_closed", direction: direction.index }));
    },
    shouldStop: () => Boolean(stopSignal)
  });
    const readyDirections = await readyDirectionsForFigma(manifest);
    const readyCount = readyDirections.length;
    const failures = activeDirectionFailures(manifest);
    const manifestFile = path.join(runDir, "figma-manifest.json");
    if (failures.length && readyCount > 0) {
    await updateRun(runFile, {
      status: "awaiting_figma",
      directionCount: readyCount,
      directionFailures: failures,
      chatgptProject: manifest.chatgptProject,
      figmaManifest: manifestFile,
      figmaSyncState,
      stages: { collection: "complete", generation: "partial", decomposition: "partial", figma: "pending" }
    });
    await notify("金融运营素材流水线等待写入 Figma", `${readyCount}/${directionCount} 套可用，${failures.length} 套失败已保留；继续同步可用方向。`);
    console.log(JSON.stringify({ status: "awaiting_figma", partial: true, runDir, manifest: manifestFile, readyCount, failures }));
    } else if (!failures.length) {
    await updateRun(runFile, {
      status: "awaiting_figma",
      directionCount: readyCount,
      directionFailures: [],
      chatgptProject: manifest.chatgptProject,
      figmaManifest: manifestFile,
      figmaSyncState,
      stages: { collection: "complete", generation: "complete", decomposition: "complete", figma: "pending" }
    });
    await notify("金融运营素材流水线", `${validationMode ? "验证素材" : "本地素材和生图"}已完成，等待写入 Figma：${runDir}`);
    console.log(JSON.stringify({ status: "awaiting_figma", runDir, manifest: manifestFile }));
    } else {
    await updateRun(runFile, {
      status: "blocked",
      directionCount: 0,
      directionFailures: failures,
      chatgptProject: manifest.chatgptProject,
      figmaManifest: manifestFile,
      figmaSyncState,
      stages: { collection: "complete", generation: "partial", decomposition: "partial", figma: "pending" }
    });
    await notify("金融运营素材流水线无可同步方向", `${failures.length} 套均失败，ChatGPT 阶段已结束，本次不写入 Figma。`);
    console.log(JSON.stringify({ status: "partial", runDir, manifest: manifestFile, readyCount: 0, failures }));
    }
  }
} catch (error) {
  if (error?.code === "CURRENT_DIRECTION_INCOMPLETE") {
    const manifest = await readJson(path.join(runDir, "figma-manifest.json"), { directions: [], failures: [] });
    const readyCount = (manifest.directions || []).filter((item) => item.status === "ready").length;
    const failures = activeDirectionFailures(manifest);
    await updateRun(runFile, {
      status: "blocked",
      blocker: {
        type: "current_direction_incomplete",
        direction: error.direction,
        stage: error.stage,
        message: error.message,
        recordedAt: new Date().toISOString()
      },
      directionCount: readyCount,
      directionFailures: failures,
      activeDirection: {
        index: error.direction,
        stage: "blocked",
        failureStage: error.stage,
        message: error.message
      },
      stages: { collection: "complete", generation: "partial", decomposition: "partial", figma: "pending" }
    });
    await notify("金融运营素材流水线已暂停", error.message);
    console.error(JSON.stringify({
      status: "blocked",
      reason: "current_direction_incomplete",
      direction: error.direction,
      stage: error.stage,
      message: error.message,
      runDir
    }));
    process.exitCode = 1;
  } else if (workflowAbortRequested(error, () => Boolean(stopSignal))) {
    const manifest = await readJson(path.join(runDir, "figma-manifest.json"), { directions: [], failures: [] });
    const readyCount = (manifest.directions || []).filter((item) => item.status === "ready").length;
    const failures = activeDirectionFailures(manifest);
    await updateRun(runFile, {
      status: "blocked",
      directionCount: readyCount,
      directionFailures: failures,
      stages: { collection: "complete", generation: "partial", decomposition: "partial", figma: "pending" }
    });
    console.log(JSON.stringify({ status: "stopped", signal: stopSignal, runDir, readyCount, failures }));
    process.exitCode = stopSignal === "SIGTERM" ? 143 : 130;
  } else {
    const failurePage = chatgpt && !chatgpt.isClosed()
      ? chatgpt
      : context?.pages()?.find((page) => page.url().startsWith("https://chatgpt.com")) || context?.pages()?.[0];
    if (failurePage) await screenshotFailure(failurePage, path.join(runDir, "fatal-error.png"));
    await appendError(runFile, "local_pipeline", error);
    await notify("金融运营素材流水线需要处理", error.message);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
} finally {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  await context?.close().catch(() => {});
  await workflowLock.release().catch(() => {});
}
