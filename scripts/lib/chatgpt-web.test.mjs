import assert from "node:assert/strict";
import test from "node:test";
import { selectReferencePair } from "./chatgpt-web.mjs";

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
