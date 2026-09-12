import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

function lobby(count = 4) {
  const state = engine.createLobby({ capacity: count, host: { id: "p1", name: "甲" } });
  for (let index = 2; index <= count; index += 1) engine.addPlayer(state, { id: `p${index}`, name: `玩家${index}` });
  return state;
}

function started(count = 4, now = 1000) {
  const state = lobby(count);
  engine.applyAction(state, "p1", { type: "start" }, { now, random: () => 0.31 });
  for (const player of state.players) engine.applyAction(state, player.id, { type: "acknowledgeSecret" }, { now: now + 100 });
  assert.equal(state.phase, "questioning");
  return state;
}

test("问答由回答者接棒并禁止立即反问上一位提问者", () => {
  const state = started();
  const asker = state.questionerId;
  const target = state.players.find((player) => player.id !== asker).id;
  engine.applyAction(state, asker, { type: "selectQuestionTarget", targetId: target }, { now: 1200 });
  assert.equal(state.questionTargetId, target);
  engine.applyAction(state, target, { type: "completeAnswer" }, { now: 1300 });
  assert.equal(state.questionerId, target);
  assert.equal(state.blockedTargetId, asker);
  assert.deepEqual(state.presentationEvents.slice(-2).map((event) => event.kind), ["question", "answer-complete"]);
  assert.notEqual(state.presentationEvents.at(-2).sceneId, state.presentationEvents.at(-1).sceneId);
  assert.ok(state.presentationEvents.slice(-2).every((event) => event.priority === 2));
  assert.equal(state.presentationEvents.at(-1).actorId, asker);
  assert.equal(state.presentationEvents.at(-1).targetId, target);
  assert.throws(() => engine.applyAction(state, target, { type: "selectQuestionTarget", targetId: asker }, { now: 1400 }), /不能选择/);
});

test("临时指认暂停问答，反对票使其恢复且指认机会不会返还", () => {
  const state = started();
  const actor = state.players.find((player) => player.id !== state.spyId);
  const target = state.players.find((player) => player.id !== actor.id);
  const originalDeadline = state.deadline;
  engine.applyAction(state, actor.id, { type: "accuse", targetId: target.id }, { now: 2000 });
  assert.equal(state.phase, "accusationVote");
  const voter = state.players.find((player) => player.id !== target.id && player.id !== actor.id);
  engine.applyAction(state, voter.id, { type: "voteAccusation", agree: false }, { now: 3000 });
  assert.equal(state.phase, "questioning");
  assert.equal(actor.accusationUsed, true);
  assert.equal(state.deadline, 3000 + originalDeadline - 2000);
});

test("全票抓到间谍由普通特工得分且主动发起者额外得分", () => {
  const state = started();
  const accuser = state.players.find((player) => player.id !== state.spyId);
  engine.applyAction(state, accuser.id, { type: "accuse", targetId: state.spyId }, { now: 2000 });
  for (const voter of state.players.filter((player) => player.id !== state.spyId && player.id !== accuser.id)) {
    engine.applyAction(state, voter.id, { type: "voteAccusation", agree: true }, { now: 2100 });
  }
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.result.winnerSide, "operatives");
  assert.equal(state.result.scoreDelta[accuser.id], 2);
  assert.equal(state.result.scoreDelta[state.spyId], 0);
});

test("间谍猜地点是一次性权威结算，猜中获得4分", () => {
  const state = started();
  engine.applyAction(state, state.spyId, { type: "spyGuess", locationId: state.location.id }, { now: 2000 });
  assert.equal(state.phase, "roundEnd");
  assert.equal(state.result.winnerSide, "spy");
  assert.equal(state.result.scoreDelta[state.spyId], 4);
});

test("问答超时进入顺序提名，缺少全票时继续而不是泄露身份", () => {
  const state = started();
  engine.handleTimeout(state, { now: state.deadline });
  assert.equal(state.phase, "timeoutNomination");
  const nominator = state.nominationOrder[0];
  const target = state.players.find((player) => player.id !== nominator).id;
  engine.applyAction(state, nominator, { type: "nominate", targetId: target }, { now: state.deadline + 1 });
  const dissenter = state.players.find((player) => player.id !== target && player.id !== nominator);
  engine.applyAction(state, dissenter.id, { type: "voteTimeoutNomination", agree: false }, { now: state.deadline + 2 });
  assert.equal(state.phase, "timeoutNomination");
  assert.equal(state.nominationIndex, 1);
  assert.equal(state.result, null);
});

test("逐玩家视图和旁观视图在结算前不泄露地点与间谍", () => {
  const state = started();
  const spyView = engine.buildView(state, state.spyId);
  const operative = state.players.find((player) => player.id !== state.spyId);
  const operativeView = engine.buildView(state, operative.id);
  const spectatorView = engine.buildSpectatorView(state);
  assert.equal(spyView.privateRole, "spy");
  assert.equal(spyView.privateLocation, null);
  assert.equal(operativeView.privateLocation.id, state.location.id);
  assert.ok(operativeView.privateLocationRole);
  assert.equal(spectatorView.privateRole, null);
  assert.equal(spectatorView.privateLocation, null);
  assert.ok(spectatorView.players.every((player) => player.role === null && player.locationRole === null));
  assert.deepEqual(spectatorView.presentationEvents, operativeView.presentationEvents);
  assert.ok(spectatorView.presentationEvents.every((event) => !JSON.stringify(event).includes(state.location.name)));
  assert.ok(spectatorView.presentationEvents.every((event) => !Object.hasOwn(event, "agree")));
});

test("指认演出公开行动方向和提交进度但不公开赞成或反对", () => {
  const state = started();
  const accuser = state.players.find((player) => player.id !== state.spyId);
  const target = state.players.find((player) => player.id !== accuser.id);
  engine.applyAction(state, accuser.id, { type: "accuse", targetId: target.id }, { now: 2000 });
  const voter = state.players.find((player) => player.id !== target.id && player.id !== accuser.id);
  engine.applyAction(state, voter.id, { type: "voteAccusation", agree: true }, { now: 2100 });
  const events = engine.buildSpectatorView(state).presentationEvents;
  assert.equal(events.at(-2).kind, "accusation");
  assert.equal(events.at(-2).actorId, accuser.id);
  assert.equal(events.at(-2).targetId, target.id);
  assert.equal(events.at(-1).kind, "vote-submitted");
  assert.equal(events.at(-1).actorId, voter.id);
  assert.equal(JSON.stringify(events).includes('"agree"'), false);
  assert.equal(events.at(-2).priority, 4);
  assert.equal(events.at(-1).priority, 1);
});

test("导致表决立即失败的反对者不会通过演出事件暴露身份", () => {
  const state = started();
  const accuser = state.players.find((player) => player.id !== state.spyId);
  const target = state.players.find((player) => player.id !== accuser.id);
  engine.applyAction(state, accuser.id, { type: "accuse", targetId: target.id }, { now: 2000 });
  const dissenter = state.players.find((player) => player.id !== target.id && player.id !== accuser.id);
  engine.applyAction(state, dissenter.id, { type: "voteAccusation", agree: false }, { now: 2100 });
  const latest = state.presentationEvents.at(-1);
  assert.equal(latest.kind, "vote-rejected");
  assert.notEqual(latest.actorId, dissenter.id);
  assert.equal(latest.text.includes(dissenter.name), false);
});

test("间谍地点猜测只在服务器完成原子结算后进入公开演出事件", () => {
  const state = started();
  const locationName = state.location.name;
  assert.equal(JSON.stringify(engine.buildSpectatorView(state).presentationEvents).includes(locationName), false);
  engine.applyAction(state, state.spyId, { type: "spyGuess", locationId: state.location.id }, { now: 2000 });
  const event = engine.buildSpectatorView(state).presentationEvents.at(-1);
  assert.equal(event.kind, "location-reveal");
  assert.match(event.text, new RegExp(locationName));
  assert.equal(state.phase, "roundEnd");
});

test("状态可以序列化并恢复关键秘密与绝对截止时间", () => {
  const state = started();
  const restored = engine.restoreState(engine.serializeState(state));
  assert.equal(restored.location.id, state.location.id);
  assert.equal(restored.spyId, state.spyId);
  assert.equal(restored.deadline, state.deadline);
  assert.equal(restored.questionerId, state.questionerId);
  assert.equal(restored.presentationSceneSequence, state.presentationSceneSequence);
  assert.deepEqual(restored.presentationEvents, state.presentationEvents);
});

test("旧快照缺少演出字段时可兼容恢复并继续分配递增序号", () => {
  const state = started();
  const legacy = engine.serializeState(state);
  delete legacy.presentationEvents;
  delete legacy.presentationSequence;
  delete legacy.presentationSceneSequence;
  const restored = engine.restoreState(legacy);
  assert.deepEqual(restored.presentationEvents, []);
  assert.equal(restored.presentationSequence, 0);
  assert.equal(restored.presentationSceneSequence, 0);
  const asker = restored.questionerId;
  const target = restored.players.find((player) => player.id !== asker).id;
  engine.applyAction(restored, asker, { type: "selectQuestionTarget", targetId: target }, { now: 2000 });
  assert.equal(restored.presentationEvents.at(-1).sequence, 1);
  assert.equal(restored.presentationEvents.at(-1).sceneId, "spyfall_scene_1");
});

test("同一表决动作的提交与轮末结算共享场景且非法动作不消耗场景序号", () => {
  const state = started(3);
  const accuser = state.players.find((player) => player.id !== state.spyId);
  engine.applyAction(state, accuser.id, { type: "accuse", targetId: state.spyId }, { now: 2000 });
  const voter = state.players.find((player) => player.id !== state.spyId && player.id !== accuser.id);
  engine.applyAction(state, voter.id, { type: "voteAccusation", agree: true }, { now: 2100 });
  const scene = state.presentationEvents.slice(-2);
  assert.deepEqual(scene.map((event) => event.kind), ["vote-submitted", "round-result"]);
  assert.equal(new Set(scene.map((event) => event.sceneId)).size, 1);
  assert.equal(scene.at(-1).priority, 4);
  const before = state.presentationSceneSequence;
  assert.throws(() => engine.applyAction(state, "p1", { type: "not-real" }, { now: 2200 }), /无法识别/);
  assert.equal(state.presentationSceneSequence, before);
  assert.equal("activePresentationScene" in state, false);
});

test("上一轮间谍成为下一轮首位提问者且第五轮结算比赛优胜者", () => {
  const state = started();
  const previousSpy = state.spyId;
  const wrongLocation = state.location.id === "airplane" ? "bank" : "airplane";
  engine.applyAction(state, state.spyId, { type: "spyGuess", locationId: wrongLocation }, { now: 2000 });
  state.round = 4;
  engine.applyAction(state, "p1", { type: "nextRound" }, { now: 3000, random: () => 0.63 });
  assert.equal(state.round, 5);
  assert.equal(state.dealerId, previousSpy);
  for (const player of state.players) engine.applyAction(state, player.id, { type: "acknowledgeSecret" }, { now: 3100 });
  engine.applyAction(state, state.spyId, { type: "spyGuess", locationId: state.location.id }, { now: 3200 });
  assert.equal(state.matchComplete, true);
  assert.ok(state.result.winners.length >= 1);
  assert.throws(() => engine.applyAction(state, "p1", { type: "nextRound" }, { now: 3300 }), /当前不能开始/);
});
