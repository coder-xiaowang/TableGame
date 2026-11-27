import assert from "node:assert/strict";
import test from "node:test";
import { createGame9PartitionRenderer, createGame9RenderModel } from "./render-partitions.mjs";

function player(id, overrides = {}) {
  return {
    id, name: id, isHost: id === "p1", connected: true,
    cards: [], cardScore: 0, chips: id === "p1" ? 5 : null, finalScore: null,
    ...overrides
  };
}

function baseView() {
  return {
    selfId: "p1", roomRole: "player", phase: "playing", capacity: 3,
    currentIndex: 0, activeCard: 17, pot: 2, deckCount: 20, deadline: 50_000,
    players: [player("p1"), player("p2"), player("p3")],
    permissions: { canManage: true, canStart: false, canEnd: true, canKick: false, canRestart: false },
    spectators: [], logs: [{ id: "l1", text: "开始", at: 1 }], winners: [], removed: []
  };
}

function clone(value) {
  return structuredClone(value);
}

function harness() {
  const calls = [];
  const dom = { actionNode: null, playerNodes: new Map(), resultVisible: false };
  let actionSequence = 0;
  const renderer = createGame9PartitionRenderer({
    room: () => calls.push("room"),
    table: () => calls.push("table"),
    players(model) {
      calls.push("players");
      const next = new Map();
      for (const item of model.view.players) next.set(item.id, dom.playerNodes.get(item.id) || { id: item.id });
      dom.playerNodes = next;
    },
    decision() {
      calls.push("decision");
      dom.actionNode = { id: ++actionSequence };
    },
    decisionFacts: () => calls.push("decisionFacts"),
    privateArea: () => calls.push("privateArea"),
    log: () => calls.push("log"),
    countdown: () => calls.push("countdown"),
    result(model) { calls.push("result"); dom.resultVisible = model.view.phase === "ended"; }
  });
  const draw = (view) => renderer.render(createGame9RenderModel(view, { memberRole: view.roomRole, roomCode: "ABCD" }));
  const clear = () => { calls.length = 0; };
  return { calls, dom, draw, clear };
}

test("日志增加不会替换当前操作按钮或玩家演出锚点", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  const playerAnchor = h.dom.playerNodes.get("p2");
  h.clear();
  const next = clone(view);
  next.logs.push({ id: "l2", text: "新增记录", at: 2 });
  assert.deepEqual(h.draw(next), ["log"]);
  assert.deepEqual(h.calls, ["log"]);
  assert.strictEqual(h.dom.actionNode, actionNode);
  assert.strictEqual(h.dom.playerNodes.get("p2"), playerAnchor);
});

test("旁观者加入不会重建牌局分区，玩家掉线只更新玩家锚点", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  const playerAnchor = h.dom.playerNodes.get("p2");
  h.clear();
  const spectatorJoined = clone(view);
  spectatorJoined.spectators.push({ id: "watch", name: "旁观者", connected: true });
  assert.deepEqual(h.draw(spectatorJoined), []);
  assert.strictEqual(h.dom.actionNode, actionNode);

  const disconnected = clone(spectatorJoined);
  disconnected.players[1].connected = false;
  assert.deepEqual(h.draw(disconnected), ["players"]);
  assert.strictEqual(h.dom.actionNode, actionNode);
  assert.strictEqual(h.dom.playerNodes.get("p2"), playerAnchor);
});

test("同一回合的桌面和私人数字变化只打补丁，不替换决策节点", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  h.clear();
  const tableChanged = clone(view);
  tableChanged.activeCard = 18;
  tableChanged.pot = 0;
  assert.deepEqual(h.draw(tableChanged), ["table", "decisionFacts"]);
  assert.strictEqual(h.dom.actionNode, actionNode);

  const privateChanged = clone(tableChanged);
  privateChanged.players[0].chips = 4;
  assert.deepEqual(h.draw(privateChanged), ["decisionFacts", "privateArea"]);
  assert.strictEqual(h.dom.actionNode, actionNode);
});

test("相同期限的普通广播不重启倒计时，新行动者会替换决策结构", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  const actionNode = h.dom.actionNode;
  h.clear();
  assert.deepEqual(h.draw(clone(view)), []);
  assert.strictEqual(h.dom.actionNode, actionNode);

  const nextTurn = clone(view);
  nextTurn.currentIndex = 1;
  const changed = h.draw(nextTurn);
  assert.ok(changed.includes("players"));
  assert.ok(changed.includes("decision"));
  assert.notStrictEqual(h.dom.actionNode, actionNode);
});

test("游戏结束会更新并显示结算分区", () => {
  const h = harness();
  const view = baseView();
  h.draw(view);
  h.clear();
  const ended = clone(view);
  ended.phase = "ended";
  ended.deadline = 0;
  ended.winners = ["p1"];
  ended.removed = [4, 9, 12];
  ended.players[0].finalScore = 10;
  ended.players[1].finalScore = 14;
  ended.players[2].finalScore = 20;
  const changed = h.draw(ended);
  assert.ok(changed.includes("result"));
  assert.equal(h.dom.resultVisible, true);
});

test("连号预览跟随公开牌，等待时保留，收牌和转为旁观时清除", () => {
  const view = baseView();
  view.players[0].cards = [18,20];
  view.currentIndex = 2;
  const h = harness();
  view.activeCard = 25;
  h.draw(view);
  assert.equal(createGame9RenderModel(view).previewCard, null);
  for (const card of [17, 19, 21]) {
    view.activeCard = card;
    assert.ok(h.draw(view).includes("privateArea"));
    assert.equal(createGame9RenderModel(view).previewCard, card);
    assert.deepEqual(view.players[0].cards, [18,20]);
  }
  assert.equal(createGame9RenderModel(view, {memberRole: "spectator"}).previewCard, null);
  view.players[0].cards.push(21);
  view.activeCard = 30;
  assert.ok(h.draw(view).includes("privateArea"));
  assert.equal(createGame9RenderModel(view).previewCard, null);
  view.activeCard = 19;
  view.phase = "ended";
  assert.equal(createGame9RenderModel(view).previewCard, null);
});
