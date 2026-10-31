import test from "node:test";
import assert from "node:assert/strict";
import { buildSalonSeatPlan, playerNameLabel } from "./player-layout.mjs";

const players = (count) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` }));

test("最少与最多人数都分配唯一固定席位", () => {
  for (const count of [4, 8]) {
    const plan = buildSalonSeatPlan(players(count), "p3");
    assert.equal(plan.length, count);
    assert.equal(new Set(plan.map(({ slot }) => slot)).size, count);
    assert.equal(plan[0].player.id, "p3");
    assert.equal(plan[0].slot, "south");
  }
});

test("旁观者保持服务器玩家顺序且不占据南侧自我席位", () => {
  const source = players(8);
  const plan = buildSalonSeatPlan(source, "spectator-id");
  assert.deepEqual(plan.map(({ player }) => player.id), source.map(({ id }) => id));
  assert.equal(plan[0].slot, "north");
});

test("昵称最多显示五个字符并保留完整短昵称", () => {
  assert.equal(playerNameLabel("阿明"), "阿明");
  assert.equal(playerNameLabel("一二三四五六七"), "一二三四五…");
});
