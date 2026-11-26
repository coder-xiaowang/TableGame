import assert from "node:assert/strict";
import test from "node:test";
import { createGame3PartitionRenderer, createGame3RenderModel } from "./render-partitions.mjs";

function totals(total = 0) {
  return { upper: total, upperBonus: 0, yahtzeeBonus: 0, total };
}

function player(id, overrides = {}) {
  return {
    id,
    name: id,
    isHost: id === "p1",
    connected: true,
    scorecard: { ones: null, twos: null, chance: null },
    totals: totals(),
    ...overrides
  };
}

function baseView() {
  return {
    selfId: "p1",
    roomRole: "player",
    phase: "playing",
    playerCount: 3,
    round: 2,
    rolls: 1,
    currentPlayerId: "p1",
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    players: [player("p1"), player("p2"), player("p3")],
    spectators: [],
    permissions: {
      canManage: true,
      canSetCapacity: false,
      canStart: false,
      canEnd: true,
      canRestart: false,
      canKick: false
    }
  };
}

function clone(value) {
  return structuredClone(value);
}

function harness() {
  const calls = [];
  const dom = { actionNode: null, playerNodes: new Map() };
  let actionSequence = 0;
  const renderer = createGame3PartitionRenderer({
    room: () => calls.push("room"),
    players(model) {
      calls.push("players");
      const next = new Map();
      for (const item of model.view.players) {
        next.set(item.id, dom.playerNodes.get(item.id) || { id: item.id });
      }
      dom.playerNodes = next;
    },
    status: () => calls.push("status"),
    dice: () => calls.push("dice"),
    turnAction() {
      calls.push("turnAction");
      dom.actionNode = { id: ++actionSequence };
    },
    turnActionFacts: () => calls.push("turnActionFacts"),
    scorecard: () => calls.push("scorecard")
  });
  const draw = (view) => renderer.render(createGame3RenderModel(view, {
    memberRole: view.roomRole,
    roomCode: "ABCD"
  }));
  const clear = () => { calls.length = 0; };
  return { calls, dom, draw, clear };
}

test("旁观者加入不重建任何牌局分区，玩家掉线只更新稳定玩家节点", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  const playerNode = h.dom.playerNodes.get("p2");
  h.clear();

  const spectatorJoined = clone(view);
  spectatorJoined.spectators.push({ id: "s1", name: "旁观者", connected: true });
  assert.deepEqual(h.draw(spectatorJoined), []);
  assert.strictEqual(h.dom.actionNode, actionNode);

  const disconnected = clone(spectatorJoined);
  disconnected.players[1].connected = false;
  assert.deepEqual(h.draw(disconnected), ["players"]);
  assert.strictEqual(h.dom.actionNode, actionNode);
  assert.strictEqual(h.dom.playerNodes.get("p2"), playerNode);
});

test("投骰只更新骰盘和当前计分预览，不替换回合操作 DOM", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  h.clear();

  const rolled = clone(view);
  rolled.dice = [6, 6, 3, 4, 5];
  assert.deepEqual(h.draw(rolled), ["dice", "scorecard"]);
  assert.strictEqual(h.dom.actionNode, actionNode);
});

test("同一回合再投出相同点数只更新投掷次数与操作提示", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  h.clear();

  const rolledAgain = clone(view);
  rolledAgain.rolls = 2;
  assert.deepEqual(h.draw(rolledAgain), ["status", "dice", "turnActionFacts"]);
  assert.strictEqual(h.dom.actionNode, actionNode);
});

test("其他玩家登记分数和零分都更新公共计分表", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  h.clear();

  const otherScored = clone(view);
  otherScored.players[1].scorecard.ones = 3;
  otherScored.players[1].totals = totals(3);
  assert.deepEqual(h.draw(otherScored), ["players","scorecard"]);
  otherScored.players[2].scorecard.twos = 0;
  assert.deepEqual(h.draw(otherScored), ["scorecard"]);
  assert.strictEqual(h.dom.actionNode, actionNode);
});

test("进入下一位玩家回合会替换旧操作结构，游戏结束会生成排名结构", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  h.clear();

  const nextTurn = clone(view);
  nextTurn.currentPlayerId = "p2";
  const nextChanged = h.draw(nextTurn);
  assert.ok(nextChanged.includes("turnAction"));
  assert.notStrictEqual(h.dom.actionNode, actionNode);

  const waitingNode = h.dom.actionNode;
  h.clear();
  const ended = clone(nextTurn);
  ended.phase = "ended";
  ended.currentPlayerId = null;
  ended.permissions.canEnd = false;
  ended.permissions.canRestart = true;
  const endedChanged = h.draw(ended);
  assert.ok(endedChanged.includes("turnAction"));
  assert.ok(endedChanged.includes("turnActionFacts"));
  assert.notStrictEqual(h.dom.actionNode, waitingNode);
});
