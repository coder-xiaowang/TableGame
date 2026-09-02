import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, ACTION_META, ROLES, createCourtDeck } from "./rules.mjs";

test("经典牌库包含五种角色各三张", () => {
  const deck = createCourtDeck();
  assert.equal(deck.length, 15);
  for (const role of Object.values(ROLES)) assert.equal(deck.filter((card) => card.role === role).length, 3);
  assert.equal(new Set(deck.map((card) => card.id)).size, 15);
});

test("行动、角色和阻挡矩阵符合基础版", () => {
  assert.equal(ACTION_META[ACTIONS.TAX].role, ROLES.DUKE);
  assert.deepEqual(ACTION_META[ACTIONS.FOREIGN_AID].blockRoles, [ROLES.DUKE]);
  assert.deepEqual(ACTION_META[ACTIONS.ASSASSINATE].blockRoles, [ROLES.CONTESSA]);
  assert.deepEqual(ACTION_META[ACTIONS.STEAL].blockRoles, [ROLES.CAPTAIN, ROLES.AMBASSADOR]);
  assert.deepEqual(ACTION_META[ACTIONS.COUP].blockRoles, []);
});
