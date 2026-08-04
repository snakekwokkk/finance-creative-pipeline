import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDirectionFailures,
  analysisPrompt,
  clearDirectionFailure,
  decompositionPrompt,
  previewPrompt,
  recordDirectionFailure,
  requiresUserAction,
  separateAssetCorrectionPrompt,
  separateAssetPrompt,
  selectReferencePair
} from "./chatgpt-web.mjs";

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
