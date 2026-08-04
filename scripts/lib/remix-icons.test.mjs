import assert from "node:assert/strict";
import test from "node:test";
import { rankRemixIconFiles } from "./remix-icons.mjs";

test("Remix Icon ranking prefers an exact semantic and style match", () => {
  const files = [
    "/icons/System/shield-check-fill.svg",
    "/icons/System/shield-check-line.svg",
    "/icons/System/shield-line.svg",
    "/icons/System/checkbox-circle-line.svg"
  ];
  const results = rankRemixIconFiles(files, "shield check", "line", 3);
  assert.equal(results[0].name, "shield-check-line");
  assert.equal(results[0].style, "line");
});

test("Remix Icon ranking returns no arbitrary match for an empty query", () => {
  assert.deepEqual(rankRemixIconFiles(["/icons/System/star-line.svg"], "", "line"), []);
});
