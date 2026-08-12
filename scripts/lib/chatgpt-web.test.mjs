import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  activeDirectionFailures,
  assertReferenceAuditSubmissionBatchSize,
  assistantReportsMissingReferenceImages,
  batchTransparentAssetsPrompt,
  attachmentDeliveryStatus,
  chatGptLoginRequired,
  chatGptSessionAuthenticated,
  chatStageMonitoringTimeout,
  chatStageSubmissionDisposition,
  clearDirectionFailure,
  conversationUrl,
  conversationApiImageCandidates,
  conversationApiSnapshotTexts,
  dailyProjectName,
  decompositionAttemptLimit,
  decompositionAttemptsExhausted,
  decompositionJsonResponses,
  decompositionObservations,
  decompositionPrompt,
  embeddedLayerIds,
  existingDecompositionConversationState,
  directionAttemptLimit,
  directionProcessingOrder,
  directionChatTitle,
  promptSubmissionDefinitelyNotAccepted,
  promptSubmissionAction,
  promptSubmissionObserved,
  directGenerationPrompt,
  parseReferenceAudit,
  projectBaseUrl,
  readyDirectionsForFigma,
  referenceAuditPacing,
  referenceAuditChatTitle,
  referenceAuditChatBootstrapPrompt,
  referenceAuditPrompt,
  referenceAuditSubmissionDelayMs,
  referenceAuditSubmissionDisposition,
  chatGptRateLimitNotice,
  reconstructedAssetPrompt,
  recordDirectionFailure,
  rejectedReferenceSourceSet,
  generationReferenceReceiptValid,
  generationReferenceUploadRequired,
  latestNewDecompositionResponse,
  latestNewDecompositionObservation,
  latestReferenceAuditResponse,
  latestNewReferenceAuditObservation,
  referenceAuditObservations,
  referenceAuditJsonResponses,
  requiresUserAction,
  rasterNeedsReconstruction,
  runDecompositionAttempts,
  runDirectionStageAttempts,
  runTransparentAssetAttempts,
  selectDirectionReference,
  directionUsesRejectedReference,
  transparentAssetAttemptLimit,
  workflowAbortedError,
  workflowAbortRequested
} from "./chatgpt-web.mjs";

test("a generated preview can enter decomposition through the shared conversation reader", async () => {
  const response = `DECOMPOSE_START
{"schemaVersion":4,"bboxFormat":"normalized-xywh-object","canvas":{"width":1002,"height":1335},"layers":[{"id":"title","editable":"text","bbox":{"x":0.1,"y":0.1,"width":0.3,"height":0.1}}]}
DECOMPOSE_END`;
  const page = {
    url: () => "https://chatgpt.com/",
    locator: (selector) => ({
      allInnerTexts: async () => selector.includes('data-message-author-role="assistant"') ? [response] : [],
      allTextContents: async () => [],
      innerText: async () => selector === "body" ? response : "",
      textContent: async () => selector === "body" ? response : ""
    })
  };
  const state = await existingDecompositionConversationState(page);
  assert.equal(state.recovered?.payload?.layers?.[0]?.id, "title");
  assert.ok(state.knownKeys.size > 0);
});

test("decomposition parsing ignores marker words embedded in prompt prose", () => {
  const prompt = `只输出标记包裹的合法JSON。严格只用三行：第一行DECOMPOSE_START，第二行是完整JSON，第三行DECOMPOSE_END。
DECOMPOSE_START
{"schemaVersion":4,"bboxFormat":"normalized-xywh-object","canvas":{"width":1002,"height":1335},"layers":[]}
DECOMPOSE_END`;
  const response = `DECOMPOSE_START
{"schemaVersion":4,"bboxFormat":"normalized-xywh-object","canvas":{"width":1002,"height":1335},"layers":[{"id":"hero","editable":"raster","bbox":{"x":0.1,"y":0.1,"width":0.5,"height":0.4}}]}
DECOMPOSE_END`;
  const observations = decompositionObservations(`${prompt}\n${response}`);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].valid, true);
  assert.equal(observations[0].payload.layers[0].id, "hero");
});

test("decomposition parsing rejects inline marker prose without treating it as JSON", () => {
  const prose = "第一行DECOMPOSE_START，第二行是完整JSON，第三行DECOMPOSE_END。";
  assert.deepEqual(decompositionObservations(prose), []);
  assert.deepEqual(decompositionJsonResponses(prose), []);
});

test("decomposition parsing accepts a valid JSON fence when ChatGPT omits markers", () => {
  const response = `\`\`\`json
{"schemaVersion":4,"bboxFormat":"normalized-xywh-object","canvas":{"width":1002,"height":1335},"layers":[{"id":"cta","editable":"vector","bbox":{"x":0.2,"y":0.8,"width":0.6,"height":0.1}}]}
\`\`\``;
  const observations = decompositionObservations(response);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].valid, true);
  assert.equal(observations[0].payload.layers[0].id, "cta");
});

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
    removalLabels: ["移除附件"],
    imageCount: 1,
    sendEnabled: true
  }).ready, true);
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

test("direct generation reuses a verified reference receipt and supports legacy receipts", () => {
  assert.equal(assistantReportsMissingReferenceImages("我目前看不到所说的参考图，请重新上传。"), true);
  assert.equal(assistantReportsMissingReferenceImages("I cannot see the uploaded reference images."), true);
  assert.equal(assistantReportsMissingReferenceImages("已分析参考图，下面输出设计规格。"), false);
  const files = ["/tmp/01-popup.webp"];
  assert.equal(generationReferenceReceiptValid({
    files: ["01-popup.webp"],
    generationSubmittedAt: "2026-08-07T08:00:00.000Z"
  }, files), true);
  assert.equal(generationReferenceReceiptValid({
    files: ["01-popup.webp"],
    analysisAcceptedAt: "2026-08-04T08:00:00.000Z"
  }, files), true);
  assert.equal(generationReferenceReceiptValid({
    files: ["01-popup.webp", "02-popup.webp"],
    analysisAcceptedAt: "2026-08-04T08:00:00.000Z"
  }, files), true);
  assert.equal(generationReferenceReceiptValid({ files: ["01-popup.webp"] }, files), false);
  assert.equal(generationReferenceUploadRequired(null, files, false), true);
  const submitted = {
    files: ["01-popup.webp"],
    generationSubmittedAt: "2026-08-07T08:00:00.000Z"
  };
  assert.equal(generationReferenceUploadRequired(submitted, files, true), false);
  assert.equal(generationReferenceUploadRequired(submitted, files, false), true);
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

test("prompt submission requires observable composer, message, or URL evidence", () => {
  const projectUrl = "https://chatgpt.com/g/g-p-abc/project";
  assert.equal(promptSubmissionObserved({
    beforeUserCount: 2,
    afterUserCount: 2,
    beforeUrl: projectUrl,
    afterUrl: projectUrl,
    composerText: "still pending"
  }), false);
  assert.equal(promptSubmissionObserved({
    beforeUserCount: 2,
    afterUserCount: 2,
    beforeUrl: projectUrl,
    afterUrl: "https://chatgpt.com/g/g-p-abc/c/new-chat",
    composerText: "still pending"
  }), true);
  assert.equal(promptSubmissionObserved({ beforeUserCount: 2, afterUserCount: 3, composerText: "" }), true);
  assert.equal(promptSubmissionObserved({ beforeUserCount: 2, afterUserCount: 2, composerText: "" }), true);
});

test("project-home first messages use one Enter action while existing chats use one click", () => {
  assert.equal(promptSubmissionAction("https://chatgpt.com/g/g-p-abc/project"), "enter");
  assert.equal(promptSubmissionAction("https://chatgpt.com/g/g-p-abc/c/conversation-id"), "click");
});

test("an unchanged ready composer is recoverable instead of ambiguously locked", () => {
  const prompt = "line one\nline two";
  assert.equal(promptSubmissionDefinitelyNotAccepted({
    expectedPrompt: prompt,
    composerText: "line one\nline two",
    sendVisible: true,
    sendEnabled: true
  }), true);
  assert.equal(promptSubmissionDefinitelyNotAccepted({
    expectedPrompt: prompt,
    composerText: "",
    sendVisible: true,
    sendEnabled: true
  }), false);
  assert.equal(promptSubmissionDefinitelyNotAccepted({
    expectedPrompt: prompt,
    composerText: prompt,
    sendVisible: false,
    sendEnabled: false
  }), false);
});

test("reference audit pacing uses conservative defaults and accepts explicit overrides", () => {
  assert.deepEqual(referenceAuditPacing(), {
    domPollIntervalMs: 1_000,
    savedConversationPollIntervalMs: 15_000,
    submissionIntervalMs: 30_000,
    rateLimitCooldownMs: 600_000
  });
  assert.deepEqual(referenceAuditPacing({
    collection: {
      visualReviewDomPollIntervalSeconds: 2,
      visualReviewSavedConversationPollIntervalSeconds: 20,
      visualReviewSubmissionIntervalSeconds: 45,
      visualReviewRateLimitCooldownMinutes: 12
    }
  }), {
    domPollIntervalMs: 2_000,
    savedConversationPollIntervalMs: 20_000,
    submissionIntervalMs: 45_000,
    rateLimitCooldownMs: 720_000
  });
});

test("reference audit submission spacing survives restarts through timestamps", () => {
  const now = Date.parse("2026-08-11T14:00:20.000Z");
  assert.equal(referenceAuditSubmissionDelayMs({
    lastSubmissionAt: "2026-08-11T14:00:00.000Z",
    now,
    intervalMs: 30_000
  }), 10_000);
  assert.equal(referenceAuditSubmissionDelayMs({
    lastSubmissionAt: "2026-08-11T13:59:00.000Z",
    now,
    intervalMs: 30_000
  }), 0);
});

test("ChatGPT frequency-limit notices are recognized without matching ordinary review text", () => {
  assert.equal(chatGptRateLimitNotice("操作太频繁，请稍后再试"), true);
  assert.equal(chatGptRateLimitNotice("Too many requests. Try again later."), true);
  assert.equal(chatGptRateLimitNotice("正在审核第 2 批候选图片"), false);
});

test("reference content audits live in dated-project chats and rely on image content", () => {
  assert.equal(referenceAuditChatTitle("popup"), "采集筛选-弹窗");
  assert.equal(referenceAuditChatTitle("banner"), "采集筛选-Banner");
  assert.match(referenceAuditChatBootstrapPrompt("采集筛选-弹窗"), /REFERENCE_AUDIT_READY/);
  const candidates = [
    { pinId: "p1", imageUrl: "https://img.example/p1.webp", title: "IMG_4953", searchKeyword: "借贷 活动弹窗", width: 900, height: 1600 },
    { pinId: "p2", imageUrl: "https://img.example/p2.webp", title: "促销元素", searchKeyword: "借贷 活动弹窗", width: 800, height: 800 }
  ];
  const prompt = referenceAuditPrompt("popup", candidates);
  assert.match(prompt, /public|imageUrl|公开/);
  assert.match(prompt, /imageAccessible/);
  assert.match(prompt, /最终结论必须以图片实际内容为主/);
  assert.match(prompt, /包含优惠券、金额或运营权益的完整弹窗应保留/);
  assert.match(prompt, /阿拉伯数字、汉字“元”、¥、\$、%、明确金额、金币、优惠券或券面、仪表盘、数据图表、折线\/趋势\/上升箭头、红包、利息\/息费/);
  assert.match(prompt, /不得因为素材属于出行、电商、会员、餐饮、工具等其他行业/);
  assert.match(prompt, /score 只用于描述与排序，没有否决权/);
  assert.match(prompt, /https:\/\/img\.example\/p1\.webp/);
  assert.doesNotMatch(prompt, /上传的候选图片|附件文件名/);

  const floatPrompt = referenceAuditPrompt("float", candidates);
  assert.match(floatPrompt, /3D素材/);
  assert.match(floatPrompt, /主体本身完整可提取/);

  const parsed = parseReferenceAudit(`REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":true,"score":88,"reasons":["完整金融弹窗"]},{"pinId":"p2","imageAccessible":true,"typeMatch":false,"completeDesign":false,"financeRelevant":false,"structureValid":false,"usableReference":false,"score":20,"reasons":["只是原子元素"]}]}
REFERENCE_AUDIT_END`, candidates);
  assert.equal(parsed.candidates[0].accepted, true);
  assert.equal(parsed.candidates[1].accepted, false);
  const softSignals = parseReferenceAudit(`REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":false,"usableReference":false,"score":20}]}
REFERENCE_AUDIT_END`, [candidates[0]]);
  assert.equal(softSignals.candidates[0].accepted, true);
  const inaccessible = parseReferenceAudit(`REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","imageAccessible":false,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":true,"score":99,"accessNote":"访问超时"}]}
REFERENCE_AUDIT_END`, [candidates[0]]);
  assert.equal(inaccessible.candidates[0].accepted, false);
  assert.deepEqual(inaccessible.candidates[0].reasons, ["访问超时"]);
  assert.throws(() => parseReferenceAudit(`REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","score":90}]}
REFERENCE_AUDIT_END`, candidates), /漏掉候选/);
});

test("the first popup audit batch passes all complete designs with broad operational signals", () => {
  const candidates = ["6771141487", "6179343771", "6746960828", "6380027999", "6708687315"]
    .map((pinId) => ({ pinId, imageUrl: `https://img.example/${pinId}.webp` }));
  const parsed = parseReferenceAudit(`REFERENCE_AUDIT_START
{"candidates":[{"pinId":"6771141487","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":false,"score":55,"reasons":["出行优惠券弹窗"]},{"pinId":"6179343771","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":false,"score":50,"reasons":["电商免单卡弹窗"]},{"pinId":"6746960828","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":true,"score":100,"reasons":["借款额度弹窗"]},{"pinId":"6380027999","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":false,"score":55,"reasons":["公交优惠券弹窗"]},{"pinId":"6708687315","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":false,"score":50,"reasons":["会员金额弹窗"]}]}
REFERENCE_AUDIT_END`, candidates);
  assert.deepEqual(parsed.candidates.map((item) => item.accepted), [true, true, true, true, true]);
});

test("reference audit marker listener finds the completed matching batch", () => {
  const candidates = [
    { pinId: "p1", imageUrl: "https://img.example/p1.webp" },
    { pinId: "p2", imageUrl: "https://img.example/p2.webp" }
  ];
  const promptExample = `REFERENCE_AUDIT_START
{"candidates":[{"pinId":"候选Pin ID","score":85}]}
REFERENCE_AUDIT_END`;
  const unrelated = `REFERENCE_AUDIT_START
{"candidates":[{"pinId":"old-pin","typeMatch":true,"completeDesign":true,"financeRelevant":true,"score":90}]}
REFERENCE_AUDIT_END`;
  const completed = `REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"structureValid":true,"usableReference":true,"score":88},{"pinId":"p2","imageAccessible":true,"typeMatch":false,"completeDesign":false,"financeRelevant":false,"structureValid":false,"usableReference":true,"score":25}]}
REFERENCE_AUDIT_END`;

  assert.equal(referenceAuditJsonResponses(`${promptExample}\n${unrelated}`, candidates).length, 0);
  const response = latestReferenceAuditResponse([
    `用户提示\n${promptExample}`,
    `历史助手回复\n${unrelated}`,
    `最新助手回复\n${completed}`
  ], candidates);
  assert.ok(response);
  assert.equal(response.audit.candidates[0].accepted, true);
  assert.equal(response.audit.candidates[1].accepted, false);
});

test("reference audit batches are submit-once and become passive monitors after arming", () => {
  const current = ["p1", "p2", "p3", "p4", "p5", "p6"];
  assert.equal(referenceAuditSubmissionDisposition(current, []), "submit");
  assert.equal(referenceAuditSubmissionDisposition(current, current), "monitor");
  assert.equal(referenceAuditSubmissionDisposition(current, ["p1", "p2"]), "conflict");
  assert.equal(referenceAuditSubmissionDisposition(current, ["old1", "old2", "old3", "old4", "old5", "old6"]), "conflict");
});

test("new reference audit submissions require six candidates while legacy recovery keeps its original size", () => {
  assert.doesNotThrow(() => assertReferenceAuditSubmissionBatchSize(6, "submit"));
  assert.throws(
    () => assertReferenceAuditSubmissionBatchSize(1, "submit"),
    (error) => error.code === "CHATGPT_REFERENCE_AUDIT_BATCH_SIZE" && /恰好包含 6 张/.test(error.message)
  );
  assert.doesNotThrow(() => assertReferenceAuditSubmissionBatchSize(1, "monitor"));
});

test("all ChatGPT stages passively monitor an armed prompt instead of resubmitting", () => {
  assert.equal(chatStageSubmissionDisposition(null, "prompt-a"), "submit");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "armed" }, "prompt-a"), "monitor");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "submission-unconfirmed" }, "prompt-a"), "monitor");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "submitted-observed" }, "prompt-a"), "monitor");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "armed" }, "prompt-b"), "conflict");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "failed-confirmed" }, "prompt-a"), "submit");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "rejected-confirmed" }, "prompt-b"), "submit");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "completed" }, "prompt-a"), "monitor");
  assert.equal(chatStageSubmissionDisposition({ promptKey: "prompt-a", status: "completed" }, "prompt-b"), "submit");
});

test("resumed ChatGPT stages use a short recovery window instead of waiting a full timeout again", () => {
  const now = Date.parse("2026-08-10T14:00:00.000Z");
  assert.equal(chatStageMonitoringTimeout(null, 300_000, now), 300_000);
  assert.equal(chatStageMonitoringTimeout({ armedAt: "2026-08-10T13:59:00.000Z" }, 300_000, now), 240_000);
  assert.equal(chatStageMonitoringTimeout({ armedAt: "2026-08-10T13:50:00.000Z" }, 300_000, now), 30_000);
});

test("reference audit recovery ignores incomplete JSON and selects the newest valid result", () => {
  const candidates = [{ pinId: "p1", imageUrl: "https://img.example/p1.webp" }];
  const first = `REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"score":70}]}
REFERENCE_AUDIT_END`;
  const second = `REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true,"score":92}]}
REFERENCE_AUDIT_END`;
  const incomplete = "REFERENCE_AUDIT_START\n{\"candidates\":[";

  assert.equal(latestReferenceAuditResponse([incomplete], candidates), null);
  assert.equal(
    latestReferenceAuditResponse([`${first}\n${incomplete}\n${second}`], candidates)?.audit.candidates[0].score,
    92
  );
});

test("reference audit listener surfaces a completed invalid response immediately", () => {
  const candidates = [
    { pinId: "p1", imageUrl: "https://img.example/p1.webp" },
    { pinId: "p2", imageUrl: "https://img.example/p2.webp" }
  ];
  const incompleteBatch = `REFERENCE_AUDIT_START
{"candidates":[{"pinId":"p1","imageAccessible":true,"typeMatch":true,"completeDesign":true,"financeRelevant":true}]}
REFERENCE_AUDIT_END`;
  const observations = referenceAuditObservations(incompleteBatch, candidates);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].valid, false);
  assert.match(observations[0].error, /漏掉候选/);
  assert.equal(latestNewReferenceAuditObservation([incompleteBatch], candidates)?.valid, false);
  assert.equal(
    latestNewReferenceAuditObservation([incompleteBatch], candidates, new Set([observations[0].key])),
    null
  );
});

test("reference audit listener reads assistant markers from saved conversation data", () => {
  const texts = conversationApiSnapshotTexts({
    mapping: {
      user: { message: { author: { role: "user" }, create_time: 1, content: { parts: ["prompt"] } } },
      assistant: {
        message: {
          author: { role: "assistant" },
          create_time: 2,
          content: { parts: ["REFERENCE_AUDIT_START\n{\"candidates\":[]}\nREFERENCE_AUDIT_END"] }
        }
      }
    }
  });
  assert.deepEqual(texts, ["REFERENCE_AUDIT_START\n{\"candidates\":[]}\nREFERENCE_AUDIT_END"]);
});

test("image monitoring reads generated image pointers from saved conversation data", () => {
  const candidates = conversationApiImageCandidates({
    mapping: {
      user: { message: { author: { role: "user" }, create_time: 1, content: { parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://reference-file" }] } } },
      generated: {
        message: {
          author: { role: "tool" },
          create_time: 2,
          content: {
            parts: [
              { content_type: "image_asset_pointer", asset_pointer: "file-service://file-generated-123" },
              { content_type: "image", image_url: "https://images.example/generated.png" }
            ]
          }
        }
      }
    }
  });
  assert.deepEqual(candidates.map((item) => item.key), [
    "file:file-generated-123",
    "url:https://images.example/generated.png"
  ]);
});

test("direct popup generation internally analyzes one attachment and outputs only an image", () => {
  const imagePrompt = directGenerationPrompt(1, "popup", 1002, 1335);
  const layersPrompt = decompositionPrompt(1, 1002, 1335, 4, "popup");
  assert.match(imagePrompt, /先在内部理解我上传的第1套参考图/);
  assert.match(imagePrompt, /直接生成且只生成一张/);
  assert.match(imagePrompt, /不要输出分析过程、设计规格、提示词、JSON 或文字说明/);
  assert.match(imagePrompt, /弹窗素材，不是完整 App 页面/);
  assert.match(imagePrompt, /不生成或暗示 App 页面/);
  assert.match(imagePrompt, /保留相近的金融视觉语义/);
  assert.doesNotMatch(imagePrompt, /FINANCE_SPEC_START|imagePrompt|referenceStructure/);
  assert.match(layersPrompt, /只输出属于弹窗本体的图层/);
  assert.match(layersPrompt, /不得创建 Background\/AppInterface/);
  assert.doesNotMatch(layersPrompt, /"id":"background"/);
});

test("decomposition records searchable Remix Icon semantics instead of invented paths", () => {
  const layersPrompt = decompositionPrompt(7, 1140, 240, 4, "banner");
  assert.match(layersPrompt, /每个普通功能图标使用kind=icon/);
  assert.match(layersPrompt, /Preview 是唯一视觉真值/);
  assert.match(layersPrompt, /所有文字、数字、金额、单位和按钮文案必须为 text/);
  assert.match(layersPrompt, /红包或信封的简单结构背板/);
  assert.match(layersPrompt, /bbox 必须使用无歧义对象 \{x,y,width,height\}/);
  assert.match(layersPrompt, /共同构成一个主视觉的复杂对象必须合并为一个 raster 组/);
  assert.match(layersPrompt, /共同构成一个主视觉的复杂对象必须合并为一个 raster 组/);
});

test("one decomposition asset prompt requests multiple separate transparent images", () => {
  const prompt = batchTransparentAssetsPrompt([
    { id: "left-ribbon", role: "Decoration/LeftRibbon", editable: "raster", assetIndex: 0, assetPrompt: "左侧彩带" },
    { id: "heart", role: "Decoration/Heart", editable: "raster", assetIndex: 1, assetPrompt: "爱心徽章" }
  ]);
  assert.match(prompt, /一次性分别生成并返回以下 2 张独立透明 PNG/);
  assert.match(prompt, /ASSET_01：左侧彩带/);
  assert.match(prompt, /ASSET_02：爱心徽章/);
  assert.match(prompt, /不是拼图、网格或素材板/);
  assert.match(prompt, /背景必须原生透明/);
});

test("decomposition asks ChatGPT to keep machine JSON visually compact", () => {
  const layersPrompt = decompositionPrompt(7, 1140, 240, 4, "banner");
  const marked = layersPrompt.match(/DECOMPOSE_START\n(\{[^\n]+\})\nDECOMPOSE_END/);
  assert.ok(marked);
  assert.match(layersPrompt, /无需上传或重新上传该图/);
  assert.match(layersPrompt, /严格只用三行/);
  assert.match(layersPrompt, /JSON内部不得换行或缩进/);
  assert.doesNotMatch(marked[1], /\n/);
  assert.equal(JSON.parse(marked[1]).canvas.width, 1140);
});

test("decomposition marker listener finds completed JSON and ignores the prompt example", () => {
  const promptExample = `DECOMPOSE_START
{"schemaVersion":4,"canvas":{"width":1002,"height":1335},"layers":[]}
DECOMPOSE_END`;
  const firstPayload = {
    schemaVersion: 5,
    strategy: "editable-native-plus-chatgpt-batch-transparent",
    canvas: { width: 1002, height: 1335 },
    layers: [{ id: "title", kind: "text", editable: "text", text: "限时权益" }]
  };
  const firstResponse = `DECOMPOSE_START\n${JSON.stringify(firstPayload)}\nDECOMPOSE_END`;
  const pageText = `用户提示\n${promptExample}\n助手回复\n${firstResponse}`;

  const parsed = decompositionJsonResponses(pageText);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].payload, firstPayload);
  assert.deepEqual(latestNewDecompositionResponse([pageText], new Set())?.payload, firstPayload);
});

test("decomposition listener reports a complete invalid result instead of waiting for timeout", () => {
  const invalid = `DECOMPOSE_START
{"schemaVersion":3,"layers":[{"id":"title"}]}
DECOMPOSE_END`;
  const observations = decompositionObservations(invalid);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].valid, false);
  assert.match(observations[0].error, /schemaVersion/);
  assert.equal(latestNewDecompositionObservation([invalid])?.valid, false);
});

test("decomposition retry reuses a late complete response before sending again", () => {
  const firstPayload = {
    schemaVersion: 4,
    canvas: { width: 1002, height: 1335 },
    layers: [{ id: "card", kind: "card", editable: "vector" }]
  };
  const secondPayload = {
    schemaVersion: 4,
    canvas: { width: 1002, height: 1335 },
    layers: [{ id: "hero", kind: "hero", editable: "raster" }]
  };
  const firstResponse = `DECOMPOSE_START\n${JSON.stringify(firstPayload)}\nDECOMPOSE_END`;
  const secondResponse = `DECOMPOSE_START\n${JSON.stringify(secondPayload)}\nDECOMPOSE_END`;
  const known = new Set(decompositionJsonResponses(firstResponse).map((response) => response.key));

  assert.equal(latestNewDecompositionResponse([firstResponse], known), null);
  assert.deepEqual(
    latestNewDecompositionResponse([`${firstResponse}\n${secondResponse}`], new Set())?.payload,
    secondPayload
  );
  assert.deepEqual(
    latestNewDecompositionResponse([`${firstResponse}\n${secondResponse}`], known)?.payload,
    secondPayload
  );
  assert.equal(latestNewDecompositionResponse(["DECOMPOSE_START\n{\"schemaVersion\":4"], known), null);
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
  assert.throws(() => selectDirectionReference(references, "float", 2), /缺少独立参考图/);
});

test("ready directions using newly rejected references are selectively invalidated", () => {
  const rejectedSources = rejectedReferenceSourceSet({
    rejections: [{ sourceUrl: "https://huaban.com/pins/6654351906?searchWord=old" }]
  });
  assert.equal(directionUsesRejectedReference({
    index: 10,
    sourceUrls: ["https://huaban.com/pins/6654351906?searchWord=different-query"]
  }, rejectedSources), true);
  assert.equal(directionUsesRejectedReference({
    index: 9,
    sourceUrls: ["https://huaban.com/pins/1234567890"]
  }, rejectedSources), false);
  assert.equal(rejectedReferenceSourceSet({
    rejections: [{ sourceUrl: "https://huaban.com/pins/6654351906", active: false }]
  }).size, 0);
});

test("human authentication blockers stop immediately", () => {
  assert.equal(requiresUserAction(new Error("ChatGPT 专用浏览器尚未登录")), true);
  assert.equal(requiresUserAction(new Error("等待 ChatGPT 生成图片超时")), false);
  assert.equal(requiresUserAction(new Error("未找到 ChatGPT 输入框，当前页面状态不支持输入")), false);
});

test("ChatGPT conversation rate limits stop the workflow globally", () => {
  assert.equal(requiresUserAction({ code: "CHATGPT_RATE_LIMITED", message: "请求过于频繁" }), true);
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

test("direct preview generation keeps its bounded retry budget", async () => {
  assert.equal(directionAttemptLimit({ generation: { maxAttempts: 2 } }), 2);
  let operations = 0;
  await assert.rejects(
    runDirectionStageAttempts({
      attempts: 2,
      stage: "generation",
      label: "预览生成",
      operation: async () => {
        operations += 1;
        throw new Error("timeout");
      }
    }),
    (error) => error.stage === "generation" && error.attempts === 2
  );
  assert.equal(operations, 2);
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

test("only large composite raster layers trigger GPT text removal and completion", () => {
  const hero = { id: "shell", editable: "raster", bbox: { x: 0.05, y: 0.05, width: 0.9, height: 0.85 }, zIndex: 1, assetPrompt: "礼盒框架" };
  const title = { id: "title", editable: "text", bbox: { x: 0.2, y: 0.2, width: 0.6, height: 0.1 }, zIndex: 5, text: "活动标题" };
  const button = { id: "button", editable: "vector", kind: "button", bbox: { x: 0.25, y: 0.7, width: 0.5, height: 0.1 }, zIndex: 5 };
  const badge = { id: "badge", editable: "raster", bbox: { x: 0.08, y: 0.1, width: 0.12, height: 0.12 }, zIndex: 4 };
  const layers = [hero, title, button, badge];
  assert.deepEqual(embeddedLayerIds(layers, hero), ["title", "button", "badge"]);
  assert.equal(rasterNeedsReconstruction(hero, layers), true);
  assert.equal(rasterNeedsReconstruction(badge, layers), false);
  const prompt = reconstructedAssetPrompt(hero, [title, button]);
  assert.match(prompt, /移除并补全/);
  assert.match(prompt, /活动标题/);
  assert.match(prompt, /纯白背景/);
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

test("transparent asset generation is configured for one formal batch submission", async () => {
  assert.equal(transparentAssetAttemptLimit({}), 1);
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
  await fs.writeFile(decompositionReport, JSON.stringify({
    schemaVersion: 5,
    strategy: "editable-native-plus-chatgpt-batch-transparent",
    status: "ready",
    transparentAssets: { engine: "native-source-pixel-matting" },
    layers: []
  }));
  const complete = { index: 1, status: "ready", previewFile, layersFile, decompositionReport };
  const incomplete = { index: 2, status: "ready", previewFile: path.join(root, "missing.png"), layersFile, decompositionReport };
  assert.deepEqual((await readyDirectionsForFigma({ directions: [complete, incomplete] })).map((item) => item.index), [1]);
});
