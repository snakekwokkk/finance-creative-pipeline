import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDirectionFailures,
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
  directionChatTitle,
  previewPrompt,
  projectBaseUrl,
  recordDirectionFailure,
  referenceAnalysisReceiptValid,
  referenceUploadRequired,
  requiresUserAction,
  runDecompositionAttempts,
  separateAssetCorrectionPrompt,
  separateAssetPrompt,
  selectReferencePair
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
  const files = ["/tmp/01-popup.webp", "/tmp/02-popup.webp"];
  assert.equal(attachmentDeliveryStatus({
    files,
    removalLabels: ["移除文件1：01-popup.webp", "移除文件2：02-popup.webp"],
    imageCount: 2,
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
    removalLabels: ["Remove file 1: 01-popup.webp", "Remove file 2: 02-popup.webp"],
    imageCount: 2,
    sendEnabled: false
  }).ready, false);
});

test("reference upload readiness does not depend on the file input retaining its FileList", () => {
  const files = ["/tmp/01-popup.webp", "/tmp/02-popup.webp"];
  assert.equal(attachmentDeliveryStatus({
    files,
    removalLabels: ["移除文件1：01-popup.webp", "移除文件2：02-popup.webp"],
    imageCount: 2,
    sendEnabled: true
  }).ready, true);
});

test("missing-reference replies force a verified re-upload and old specs need a receipt", () => {
  assert.equal(assistantReportsMissingReferenceImages("我目前看不到所说的两张参考图，请重新上传。"), true);
  assert.equal(assistantReportsMissingReferenceImages("I cannot see the uploaded reference images."), true);
  assert.equal(assistantReportsMissingReferenceImages("已分析两张参考图，下面输出设计规格。"), false);
  const files = ["/tmp/01-popup.webp", "/tmp/02-popup.webp"];
  assert.equal(referenceAnalysisReceiptValid({
    files: ["01-popup.webp", "02-popup.webp"],
    analysisAcceptedAt: "2026-08-04T08:00:00.000Z"
  }, files), true);
  assert.equal(referenceAnalysisReceiptValid({ files: ["01-popup.webp", "02-popup.webp"] }, files), false);
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

test("reference pairs stay inside the requested creative type", () => {
  const references = [
    { pinId: "p1", referenceType: "popup" },
    { pinId: "p2", referenceType: "popup" },
    { pinId: "b1", referenceType: "banner" },
    { pinId: "b2", referenceType: "banner" },
    { pinId: "f1", referenceType: "float" },
    { pinId: "f2", referenceType: "float" }
  ];
  assert.deepEqual(selectReferencePair(references, "banner", 0).map((item) => item.pinId), ["b1", "b2"]);
  assert.deepEqual(selectReferencePair(references, "float", 0).map((item) => item.pinId), ["f1", "f2"]);
});

test("human authentication blockers stop immediately", () => {
  assert.equal(requiresUserAction(new Error("ChatGPT 专用浏览器尚未登录")), true);
  assert.equal(requiresUserAction(new Error("等待 ChatGPT 生成图片超时")), false);
});

test("decomposition has three independent attempts and recovers the same chat before retrying", async () => {
  assert.equal(decompositionAttemptLimit({}), 3);
  assert.equal(decompositionAttemptLimit({ generation: { decompositionMaxAttempts: 2 } }), 2);
  let operations = 0;
  let recoveries = 0;
  const result = await runDecompositionAttempts({
    attempts: 3,
    recover: async () => { recoveries += 1; },
    operation: async () => {
      operations += 1;
      if (operations < 3) throw new Error("GPT 无响应");
      return "ready";
    }
  });
  assert.equal(result, "ready");
  assert.equal(operations, 3);
  assert.equal(recoveries, 2);
});

test("exhausted decomposition attempts are stage-specific and do not consume generation retries", async () => {
  await assert.rejects(
    runDecompositionAttempts({ attempts: 3, operation: async () => { throw new Error("timeout"); } }),
    (error) => error.code === "DECOMPOSITION_ATTEMPTS_EXHAUSTED"
      && error.stage === "decomposition"
      && error.attempts === 3
  );
  const error = decompositionAttemptsExhausted(new Error("timeout"), 3);
  assert.equal(error.stage, "decomposition");
  assert.equal(error.attempts, 3);
});

test("failed directions remain resumable without hiding completed directions", () => {
  const manifest = { directions: [{ index: 1, status: "ready" }], failures: [] };
  recordDirectionFailure(manifest, { index: 2, message: "timeout" });
  assert.deepEqual(activeDirectionFailures(manifest).map((item) => item.index), [2]);
  manifest.directions.push({ index: 2, status: "ready" });
  clearDirectionFailure(manifest, 2);
  assert.deepEqual(activeDirectionFailures(manifest), []);
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
