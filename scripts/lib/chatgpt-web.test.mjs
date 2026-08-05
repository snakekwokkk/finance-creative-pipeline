import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  activeDirectionFailures,
  analysisAttemptLimit,
  analysisPrompt,
  assistantReportsMissingReferenceImages,
  attachmentDeliveryStatus,
  chatGptLoginRequired,
  chatGptSessionAuthenticated,
  clearDirectionFailure,
  conversationUrl,
  dailyProjectName,
  decompositionAttemptLimit,
  decompositionAttemptsExhausted,
  decompositionPrompt,
  directionAttemptLimit,
  enqueueAnalysisFinalRetry,
  directionProcessingOrder,
  directionChatTitle,
  previewPrompt,
  projectBaseUrl,
  readyDirectionsForFigma,
  recordDirectionFailure,
  referenceAnalysisReceiptValid,
  referenceUploadRequired,
  requiresUserAction,
  runDecompositionAttempts,
  runDirectionStageAttempts,
  runTransparentAssetAttempts,
  separateAssetCorrectionPrompt,
  separateAssetPrompt,
  selectDirectionReference,
  transparentAssetAttemptLimit,
  workflowAbortedError,
  workflowAbortRequested
} from "./chatgpt-web.mjs";

test("ChatGPT login detection ignores unrelated sidebar text", () => {
  assert.equal(chatGptLoginRequired({ url: "https://chatgpt.com/", visibleLoginControls: 0 }), false);
  assert.equal(chatGptLoginRequired({ url: "https://chatgpt.com/auth/login", visibleLoginControls: 0 }), true);
  assert.equal(chatGptLoginRequired({ url: "https://chatgpt.com/", visibleLoginControls: 1 }), true);
  assert.equal(chatGptSessionAuthenticated({ WARNING_BANNER: {} }), false);
  assert.equal(chatGptSessionAuthenticated({ user: { id: "user-1" } }), true);
  assert.equal(chatGptSessionAuthenticated({ accessToken: "present" }), true);
});

test("reference uploads are accepted only after every image attachment is visibly ready", () => {
  const files = ["/tmp/01-popup.webp"];
  assert.equal(attachmentDeliveryStatus({
    files,
    removalLabels: ["移除文件1：01-popup.webp"],
    imageCount: 1,
    sendEnabled: true
  }).ready, true);
  assert.equal(attachmentDeliveryStatus({
    files,
    removalLabels: [],
    imageCount: 0,
    sendEnabled: true
  }).ready, false);
  assert.equal(attachmentDeliveryStatus({
    files,
    removalLabels: ["Remove file 1: 01-popup.webp"],
    imageCount: 1,
    sendEnabled: false
  }).ready, false);
});

test("reference upload readiness does not depend on the file input retaining its FileList", () => {
  const files = ["/tmp/01-popup.webp"];
  assert.equal(attachmentDeliveryStatus({
    files,
    removalLabels: ["移除文件1：01-popup.webp"],
    imageCount: 1,
    sendEnabled: true
  }).ready, true);
});

test("missing-reference replies force a verified re-upload and old specs need a receipt", () => {
  assert.equal(assistantReportsMissingReferenceImages("我目前看不到所说的参考图，请重新上传。"), true);
  assert.equal(assistantReportsMissingReferenceImages("I cannot see the uploaded reference images."), true);
  assert.equal(assistantReportsMissingReferenceImages("已分析参考图，下面输出设计规格。"), false);
  const files = ["/tmp/01-popup.webp"];
  assert.equal(referenceAnalysisReceiptValid({
    files: ["01-popup.webp"],
    analysisAcceptedAt: "2026-08-04T08:00:00.000Z"
  }, files), true);
  assert.equal(referenceAnalysisReceiptValid({
    files: ["01-popup.webp", "02-popup.webp"],
    analysisAcceptedAt: "2026-08-04T08:00:00.000Z"
  }, files), true);
  assert.equal(referenceAnalysisReceiptValid({ files: ["01-popup.webp"] }, files), false);
  assert.equal(referenceUploadRequired(null, false), true);
  assert.equal(referenceUploadRequired({ composition: "cached" }, false), false);
  assert.equal(referenceUploadRequired(null, true), false);
});

test("daily ChatGPT projects and direction chat URLs are deterministic", () => {
  assert.equal(dailyProjectName({}, "2026-08-04"), "金融运营素材 2026-08-04");
  assert.equal(
    dailyProjectName({ chatgpt: { projectNamePrefix: "运营设计" } }, "2026-08-04"),
    "运营设计 2026-08-04"
  );
  const projectUrl = "https://chatgpt.com/g/g-p-abc-finance/project";
  const chatUrl = "https://chatgpt.com/g/g-p-abc-finance/c/conversation-id?messageId=latest";
  assert.equal(projectBaseUrl(projectUrl), "https://chatgpt.com/g/g-p-abc-finance");
  assert.equal(projectBaseUrl(chatUrl), "https://chatgpt.com/g/g-p-abc-finance");
  assert.equal(conversationUrl(chatUrl), "https://chatgpt.com/g/g-p-abc-finance/c/conversation-id");
  assert.equal(conversationUrl(projectUrl), null);
  assert.equal(
    projectBaseUrl("https://chatgpt.com/g/g-p-6a72a11271308191955d8e89224386db-finance-project/c/conversation-id"),
    "https://chatgpt.com/g/g-p-6a72a11271308191955d8e89224386db"
  );
});

test("direction chats use type-local numbering instead of global direction numbers", () => {
  assert.equal(directionChatTitle("popup", 0), "弹窗1");
  assert.equal(directionChatTitle("popup", 5), "弹窗6");
  assert.equal(directionChatTitle("banner", 0), "Banner1");
  assert.equal(directionChatTitle("banner", 1), "Banner2");
  assert.equal(directionChatTitle("float", 0), "浮窗1");
  assert.equal(directionChatTitle("float", 1), "浮窗2");
  assert.throws(() => directionChatTitle("unknown", 0), /不支持的方向类型/);
});

test("popup prompts generate and decompose only the popup body", () => {
  const specPrompt = analysisPrompt(1, "popup");
  const imagePrompt = previewPrompt({ imagePrompt: "红色金融弹窗" }, 1002, 1335, "popup");
  const layersPrompt = decompositionPrompt(1, 1002, 1335, 4, "popup");
  assert.match(specPrompt, /只分析和设计弹窗本体/);
  assert.match(specPrompt, /一张参考图/);
  assert.match(specPrompt, /不要把参考图中的 App 页面/);
  assert.match(imagePrompt, /弹窗素材，不是完整 App 页面/);
  assert.match(imagePrompt, /不生成或暗示 App 页面/);
  assert.match(layersPrompt, /只输出属于弹窗本体的图层/);
  assert.match(layersPrompt, /不得创建 Background\/AppInterface/);
  assert.doesNotMatch(layersPrompt, /"id":"background"/);
});

test("decomposition records searchable Remix Icon semantics instead of invented paths", () => {
  const layersPrompt = decompositionPrompt(7, 1140, 240, 4, "banner");
  assert.match(layersPrompt, /每个普通功能图标使用kind=icon/);
  assert.match(layersPrompt, /query用2到4个简短英文词/);
  assert.match(layersPrompt, /"query":"shield check"/);
  assert.match(layersPrompt, /"style":"line"/);
  assert.match(layersPrompt, /不要臆造图标库文件名/);
});

test("decomposition asks ChatGPT to keep machine JSON visually compact", () => {
  const layersPrompt = decompositionPrompt(7, 1140, 240, 4, "banner");
  const marked = layersPrompt.match(/DECOMPOSE_START\n(\{[^\n]+\})\nDECOMPOSE_END/);
  assert.ok(marked);
  assert.match(layersPrompt, /严格只用三行/);
  assert.match(layersPrompt, /JSON内部不得换行或缩进/);
  assert.doesNotMatch(marked[1], /\n/);
  assert.equal(JSON.parse(marked[1]).canvas.width, 1140);
});

test("each direction receives one reference from its matching creative type", () => {
  const references = [
    { pinId: "p1", referenceType: "popup" },
    { pinId: "p2", referenceType: "popup" },
    { pinId: "b1", referenceType: "banner" },
    { pinId: "b2", referenceType: "banner" },
    { pinId: "f1", referenceType: "float" },
    { pinId: "f2", referenceType: "float" }
  ];
  assert.equal(selectDirectionReference(references, "banner", 0).pinId, "b1");
  assert.equal(selectDirectionReference(references, "banner", 1).pinId, "b2");
  assert.equal(selectDirectionReference(references, "float", 0).pinId, "f1");
});

test("human authentication blockers stop immediately", () => {
  assert.equal(requiresUserAction(new Error("ChatGPT 专用浏览器尚未登录")), true);
  assert.equal(requiresUserAction(new Error("等待 ChatGPT 生成图片超时")), false);
  assert.equal(requiresUserAction(new Error("未找到 ChatGPT 输入框，当前页面状态不支持输入")), false);
});

test("manual workflow stops are distinct from direction failures", () => {
  const aborted = workflowAbortedError(new Error("page context closed"));
  assert.equal(aborted.code, "WORKFLOW_ABORTED");
  assert.equal(workflowAbortRequested(aborted), true);
  assert.equal(workflowAbortRequested(new Error("page context closed"), () => true), true);
  assert.equal(workflowAbortRequested(new Error("direction timeout"), () => false), false);
});

test("resumed runs process new directions before previously failed directions", () => {
  const manifest = {
    directions: [{ index: 1, status: "ready" }],
    failures: [{ index: 2, stage: "generation" }]
  };
  assert.deepEqual(directionProcessingOrder(5, manifest), [1, 3, 4, 5, 2]);
  assert.equal(directionAttemptLimit({ generation: { maxAttempts: 2 } }), 2);
  assert.equal(directionAttemptLimit({ generation: { maxAttempts: 2 } }, true), 1);
});

test("reference analysis has two attempts plus one queue-tail final retry", async () => {
  assert.equal(analysisAttemptLimit({}), 2);
  assert.equal(analysisAttemptLimit({ generation: { analysisMaxAttempts: 2 } }, true), 1);
  let operations = 0;
  await assert.rejects(
    runDirectionStageAttempts({
      attempts: 2,
      stage: "analysis",
      label: "参考分析",
      operation: async () => {
        operations += 1;
        throw new Error("timeout");
      }
    }),
    (error) => error.stage === "analysis" && error.attempts === 2
  );
  assert.equal(operations, 2);
  const queue = [{ index: 1, historicalFailure: false, analysisFinalRetry: false }];
  assert.equal(enqueueAnalysisFinalRetry(queue, 1, { stage: "analysis", finalRetry: false }), true);
  assert.deepEqual(queue[1], { index: 1, historicalFailure: false, analysisFinalRetry: true });
  assert.equal(enqueueAnalysisFinalRetry(queue, 1, { stage: "analysis", finalRetry: false }), false);
  assert.equal(enqueueAnalysisFinalRetry(queue, 2, { stage: "generation", finalRetry: false }), false);
});

test("semantic decomposition has at most two independent attempts", async () => {
  assert.equal(decompositionAttemptLimit({}), 2);
  assert.equal(decompositionAttemptLimit({ generation: { decompositionMaxAttempts: 2 } }), 2);
  assert.equal(decompositionAttemptLimit({ generation: { decompositionMaxAttempts: 2 } }, true), 1);
  let operations = 0;
  let recoveries = 0;
  const result = await runDecompositionAttempts({
    attempts: 2,
    recover: async () => { recoveries += 1; },
    operation: async () => {
      operations += 1;
      if (operations < 2) throw new Error("GPT 无响应");
      return "ready";
    }
  });
  assert.equal(result, "ready");
  assert.equal(operations, 2);
  assert.equal(recoveries, 1);
});

test("exhausted decomposition attempts are stage-specific and do not consume generation retries", async () => {
  await assert.rejects(
    runDecompositionAttempts({ attempts: 2, operation: async () => { throw new Error("timeout"); } }),
    (error) => error.code === "DECOMPOSITION_ATTEMPTS_EXHAUSTED"
      && error.stage === "decomposition"
      && error.attempts === 2
  );
  const error = decompositionAttemptsExhausted(new Error("timeout"), 2);
  assert.equal(error.stage, "decomposition");
  assert.equal(error.attempts, 2);
});

test("transparent assets have their own two-attempt budget", async () => {
  assert.equal(transparentAssetAttemptLimit({}), 2);
  assert.equal(transparentAssetAttemptLimit({ transparentAssets: { maxAttempts: 2 } }, true), 1);
  let operations = 0;
  const result = await runTransparentAssetAttempts({
    attempts: 2,
    layer: { id: "hero" },
    operation: async () => {
      operations += 1;
      if (operations === 1) throw new Error("bad alpha");
      return "ready";
    }
  });
  assert.equal(result, "ready");
  assert.equal(operations, 2);
});

test("failed directions remain resumable without hiding completed directions", () => {
  const manifest = { directions: [{ index: 1, status: "ready" }], failures: [] };
  recordDirectionFailure(manifest, { index: 2, message: "timeout" });
  assert.deepEqual(activeDirectionFailures(manifest).map((item) => item.index), [2]);
  manifest.directions.push({ index: 2, status: "ready" });
  clearDirectionFailure(manifest, 2);
  assert.deepEqual(activeDirectionFailures(manifest), []);
});

test("Figma handoff includes only ready directions with complete local artifacts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "finance-figma-ready-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previewFile = path.join(root, "preview.png");
  const layersFile = path.join(root, "layers.json");
  const decompositionReport = path.join(root, "decomposition-report.json");
  await sharp({ create: { width: 100, height: 100, channels: 4, background: "#ffffff" } })
    .png({ compressionLevel: 0 })
    .toFile(previewFile);
  await fs.writeFile(layersFile, JSON.stringify({ schemaVersion: 4, layers: [{ id: "title", editable: "text" }] }));
  await fs.writeFile(decompositionReport, JSON.stringify({ schemaVersion: 4, status: "ready", layers: [] }));
  const complete = { index: 1, status: "ready", previewFile, layersFile, decompositionReport };
  const incomplete = { index: 2, status: "ready", previewFile: path.join(root, "missing.png"), layersFile, decompositionReport };
  assert.deepEqual((await readyDirectionsForFigma({ directions: [complete, incomplete] })).map((item) => item.index), [1]);
});

test("separate asset prompts stay short and require fidelity plus transparency", () => {
  const layer = { id: "hero", role: "Visual/Hero", assetPrompt: "完整主视觉" };
  const prompt = separateAssetPrompt(layer);
  assert.match(prompt, /完整主视觉/);
  assert.match(prompt, /与原图一致/);
  assert.match(prompt, /透明背景高清 PNG/);
  assert.ok(prompt.length < 180);
  const correction = separateAssetCorrectionPrompt(layer, "主体触碰边界");
  assert.match(correction, /重新从原图单独提取/);
  assert.match(correction, /主体触碰边界/);
});
