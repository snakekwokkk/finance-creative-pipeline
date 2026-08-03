import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDirectionFailures,
  clearDirectionFailure,
  recordDirectionFailure,
  requiresUserAction,
  selectReferencePair
} from "./chatgpt-web.mjs";

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
