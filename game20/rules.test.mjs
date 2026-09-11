import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PLAYERS, MIN_PLAYERS, ROLE, WORD_BANK, assignRoles, chooseWord } from "./rules.mjs";

test("独立中文词库包含300个唯一题目", () => {
  assert.equal(WORD_BANK.length, 300);
  assert.equal(new Set(WORD_BANK.map((word) => word.id)).size, 300);
  assert.equal(new Set(WORD_BANK.map((word) => word.text)).size, 300);
  assert.ok(WORD_BANK.every((word) => word.category && word.text));
});

test("4至8人身份始终包含一名主持人与一名局内人", () => {
  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count += 1) {
    const roles = [...assignRoles(Array.from({ length: count }, (_, index) => `p${index + 1}`), () => .42).values()];
    assert.equal(roles.filter((role) => role === ROLE.MASTER).length, 1);
    assert.equal(roles.filter((role) => role === ROLE.INSIDER).length, 1);
    assert.equal(roles.filter((role) => role === ROLE.COMMON).length, count - 2);
  }
});

test("选题优先避开近期题目并在全部屏蔽时安全回退", () => {
  const recent = WORD_BANK.slice(0, -1).map((word) => word.id);
  assert.equal(chooseWord(recent, () => 0).id, WORD_BANK.at(-1).id);
  assert.equal(chooseWord(WORD_BANK.map((word) => word.id), () => 0).id, WORD_BANK[0].id);
});

