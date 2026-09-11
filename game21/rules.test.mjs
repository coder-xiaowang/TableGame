import assert from "node:assert/strict";
import test from "node:test";
import { LOCATIONS, LOCATION_IDS, dealRound } from "./rules.mjs";

test("中文版地点库包含30个唯一地点且每处有7个唯一身份", () => {
  assert.equal(LOCATIONS.length, 30);
  assert.equal(new Set(LOCATION_IDS).size, 30);
  for (const location of LOCATIONS) {
    assert.equal(location.roles.length, 7, location.name);
    assert.equal(new Set(location.roles).size, 7, location.name);
  }
});

test("3至8人发牌始终只有一名间者且普通玩家身份不重复", () => {
  for (let count = 3; count <= 8; count += 1) {
    const deal = dealRound(Array.from({ length: count }, (_, index) => `p${index + 1}`), LOCATIONS[0], () => 0.37);
    const assignments = [...deal.values()];
    assert.equal(assignments.filter((item) => item.role === "spy").length, 1);
    const roles = assignments.filter((item) => item.locationRole).map((item) => item.locationRole);
    assert.equal(new Set(roles).size, count - 1);
  }
});
