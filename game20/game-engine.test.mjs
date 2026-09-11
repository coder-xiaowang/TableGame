import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";
import { QUESTION_SECONDS, ROLE } from "./rules.mjs";

function room(count = 4) {
  const state = engine.createLobby({ capacity: count, host: { id: "p1", name: "甲" } });
  for (let index = 2; index <= count; index += 1) engine.addPlayer(state, { id: `p${index}`, name: `玩家${index}` });
  engine.applyAction(state, "p1", { type: "start" }, { now: 1000, random: () => .31 });
  return state;
}

function acknowledge(state, now = 2000) {
  engine.applyAction(state, state.masterId, { type: "acknowledgeSecret" }, { now });
  engine.applyAction(state, state.insiderId, { type: "acknowledgeSecret" }, { now: now + 1 });
  assert.equal(state.phase, "questioning");
}

function common(state) { return state.players.find((player) => player.role === ROLE.COMMON); }

test("开局身份和答案只进入有权查看的玩家视图", () => {
  const state = room();
  const master = engine.buildView(state, state.masterId);
  const insider = engine.buildView(state, state.insiderId);
  const ordinary = engine.buildView(state, common(state).id);
  const spectator = engine.buildSpectatorView(state);
  assert.equal(master.privateRole, ROLE.MASTER);
  assert.equal(insider.privateRole, ROLE.INSIDER);
  assert.equal(master.secretWord.text, state.word.text);
  assert.equal(insider.secretWord.text, state.word.text);
  assert.equal(ordinary.secretWord, null);
  assert.equal(spectator.secretWord, null);
  assert.ok(ordinary.players.every((player) => player.role === ROLE.MASTER || player.role === null));
  assert.ok(ordinary.players.every((player) => !("secretAcknowledged" in player)));
  assert.ok(spectator.players.every((player) => !("secretAcknowledged" in player)));
  assert.equal(JSON.stringify(spectator).includes(state.word.text), false);
  assert.ok(spectator.players.every((player) => player.role === ROLE.MASTER || player.role === null));
});

test("双方秘密确认后开启服务器五分钟猜词计时", () => {
  const state = room();
  acknowledge(state, 5000);
  assert.equal(state.questionStartedAt, 5001);
  assert.equal(state.deadline, 5001 + QUESTION_SECONDS * 1000);
});

test("只有主持人能同步回答并标记正确猜中者", () => {
  const state = room(); acknowledge(state);
  const guesser = common(state);
  assert.throws(() => engine.applyAction(state, guesser.id, { type: "showMasterAnswer", answer: "yes" }), /只有主持人/);
  engine.applyAction(state, state.masterId, { type: "showMasterAnswer", answer: "yes" }, { now: 3000 });
  assert.equal(state.answerHistory[0].answer, "yes");
  engine.applyAction(state, state.masterId, { type: "markCorrectGuesser", playerId: guesser.id }, { now: 12001 });
  assert.equal(state.phase, "discussion");
  assert.equal(state.guessElapsedMs, 10000);
  assert.equal(state.deadline, 22001);
});

test("普通猜中者被正确排除后进入第二次秘密投票并找出局内人", () => {
  const state = room(); acknowledge(state);
  const guesser = common(state);
  engine.applyAction(state, state.masterId, { type: "markCorrectGuesser", playerId: guesser.id }, { now: 4000 });
  engine.handleTimeout(state, { now: state.deadline });
  for (const player of state.players.filter((player) => player.id !== guesser.id)) {
    engine.applyAction(state, player.id, { type: "submitFirstVote", accuse: false }, { now: 5000 });
  }
  assert.equal(state.phase, "secondVote");
  const pendingView = engine.buildView(state, state.masterId);
  assert.equal(pendingView.firstVoteResult.accused, false);
  for (const player of state.players) {
    engine.applyAction(state, player.id, { type: "submitSecondVote", targetId: state.insiderId }, { now: 6000 });
  }
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.result.winnerSide, "common");
  assert.equal(state.result.accusedId, state.insiderId);
});

test("局内人亲自猜中但未被多数指控时立即获胜", () => {
  const state = room(); acknowledge(state);
  engine.applyAction(state, state.masterId, { type: "markCorrectGuesser", playerId: state.insiderId }, { now: 4000 });
  engine.handleTimeout(state, { now: state.deadline });
  for (const player of state.players.filter((player) => player.id !== state.insiderId)) {
    engine.applyAction(state, player.id, { type: "submitFirstVote", accuse: false }, { now: 5000 });
  }
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.result.winnerSide, "insider");
});

test("第二次投票平票由猜中者裁决", () => {
  const state = room(); acknowledge(state);
  const guesser = common(state);
  engine.applyAction(state, state.masterId, { type: "markCorrectGuesser", playerId: guesser.id }, { now: 4000 });
  engine.handleTimeout(state, { now: state.deadline });
  for (const player of state.players.filter((player) => player.id !== guesser.id)) {
    engine.applyAction(state, player.id, { type: "submitFirstVote", accuse: false });
  }
  const candidates = state.players.filter((player) => player.id !== state.masterId && player.id !== guesser.id);
  state.players.forEach((player, index) => engine.applyAction(state, player.id, { type: "submitSecondVote", targetId: candidates[index % 2].id }));
  assert.equal(state.phase, "tieBreak");
  engine.applyAction(state, guesser.id, { type: "resolveTie", targetId: state.insiderId });
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.result.winnerSide, "common");
});

test("猜词超时全员失败并在结算视图公开答案与身份", () => {
  const state = room(); acknowledge(state);
  assert.equal(engine.handleTimeout(state, { now: state.deadline }), true);
  assert.equal(state.result.winnerSide, null);
  const view = engine.buildSpectatorView(state);
  assert.equal(view.secretWord.text, state.word.text);
  assert.ok(view.players.every((player) => player.role));
});

test("进行中不能换席且旁观视图不能调用正式玩家动作", () => {
  const state = room();
  assert.equal(engine.canChangeSeats(state), false);
  assert.throws(() => engine.vacateSeat(state, "p2"), /游戏开始后/);
  assert.throws(() => engine.buildView(state, "spectator"), /不在玩家席/);
});

test("序列化恢复保留身份、答案、投票与截止时间", () => {
  const state = room(); acknowledge(state);
  const guesser = common(state);
  engine.applyAction(state, state.masterId, { type: "markCorrectGuesser", playerId: guesser.id }, { now: 9000 });
  engine.handleTimeout(state, { now: state.deadline });
  const voter = state.players.find((player) => player.id !== guesser.id);
  engine.applyAction(state, voter.id, { type: "submitFirstVote", accuse: true });
  const restored = engine.restoreState(engine.serializeState(state));
  assert.equal(restored.word.text, state.word.text);
  assert.equal(restored.insiderId, state.insiderId);
  assert.equal(restored.deadline, state.deadline);
  assert.equal(restored.firstVotes[voter.id], true);
});

test("旁观者在两轮投票期间只看到提交进度而不会触发权限视图异常", () => {
  const state = room(); acknowledge(state);
  const guesser = common(state);
  engine.applyAction(state, state.masterId, { type: "markCorrectGuesser", playerId: guesser.id }, { now: 5000 });
  engine.handleTimeout(state, { now: state.deadline });
  const voter = state.players.find((player) => player.id !== guesser.id);
  engine.applyAction(state, voter.id, { type: "submitFirstVote", accuse: false });
  const watched = engine.buildSpectatorView(state);
  assert.equal(watched.permissions.canFirstVote, false);
  assert.equal(watched.myFirstVote, null);
  assert.deepEqual(watched.submittedFirstVoteIds, [voter.id]);
  assert.equal(watched.firstVoteResult, null);
});
