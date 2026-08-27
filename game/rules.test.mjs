import assert from "node:assert/strict";
import test from "node:test";
import { TOPICS, createDerangement, normalizeSubmission, normalizeWord, uniqueTopicWords } from "./rules.mjs";

test("game word topics provide enough unique entries", () => {
  assert.ok(Object.keys(TOPICS).length >= 9);
  assert.ok(Object.keys(TOPICS).every((topic) => uniqueTopicWords(topic).length >= 16));
  assert.equal(uniqueTopicWords("日用品").filter((word) => word === "钥匙").length, 1);
});

test("game derangement never assigns a player's own submission", () => {
  for (const size of [2,3,4,8,16]) {
    const order = createDerangement(size, () => 0.25);
    assert.equal(new Set(order).size, size);
    assert.ok(order.every((source, target) => source !== target));
  }
});

test("game word normalization and submission validation are strict", () => {
  assert.equal(normalizeWord(" 哈 利 · 波 特 "), "哈利·波特");
  assert.deepEqual(
    normalizeSubmission({word:" 如懿 ",trapWord:"甄嬛",extra:" 不能问 朝代 "},{playerWordMode:"trap",wordExtraMode:"forbidden"}),
    {word:"如懿",trapWord:"甄嬛",extra:"不能问 朝代"}
  );
  assert.throws(
    () => normalizeSubmission({word:"如懿",trapWord:" 如 懿 ",extra:""},{playerWordMode:"trap",wordExtraMode:"none"}),
    /不能相同/
  );
});
