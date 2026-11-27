import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer, applyAction, buildSpectatorView, buildView, createLobby,
  handleTimeout, removePlayer, restoreState, serializeState
} from "./server/game-engine.mjs";
import { DISCUSSION_SECONDS, RESOLUTION_SECONDS } from "./rules.mjs";

const fixedRandom = () => .314159;
function setup(capacity = 4) {
  const state = createLobby({ capacity, host: { id: "p1", name: "一号" } });
  for (let index = 2; index <= capacity; index += 1) addPlayer(state, { id: `p${index}`, name: `${index}号` });
  applyAction(state, "p1", { type: "start" }, { now: 1000, random: fixedRandom });
  return state;
}
function submitStory(state, now = 2000) {
  const teller = state.players.find((player) => player.id === state.storytellerId);
  applyAction(state, teller.id, { type: "submitStory", cardId: teller.hand[0].id, clueMode: "text", clueText: "倒着生长的月亮" }, { now, random: fixedRandom });
  return teller;
}

test("host can remove another traveler only before the gallery opens",()=>{
  const lobby=createLobby({capacity:3,host:{id:"p1",name:"一号"}});addPlayer(lobby,{id:"p2",name:"二号"});addPlayer(lobby,{id:"p3",name:"三号"});
  removePlayer(lobby,"p1","p2");assert.equal(lobby.players.some((player)=>player.id==="p2"),false);assert.throws(()=>removePlayer(lobby,"p1","p1"),/不能移出/);
  const active=setup(3);assert.throws(()=>removePlayer(active,"p1","p2"),/游戏开始后/);assert.equal(active.players.length,3);
});

test("authoritative flow hides submissions and reveals owners only at resolution", () => {
  const state = setup(4); const teller = submitStory(state);
  const others = state.players.filter((player) => player.id !== teller.id);
  const before = buildView(state, others[0].id);
  assert.equal(before.displayCards.length, 0);
  assert.equal(JSON.stringify(before).includes(state.storytellerSubmission.cards[0].id), false);
  others.forEach((player, index) => applyAction(state, player.id, { type: "submitDecoys", cardIds: [player.hand[0].id] }, { now: 3000 + index, random: fixedRandom }));
  assert.equal(state.phase, "voting");
  const spectator = buildSpectatorView(state);
  assert.equal(spectator.hand.length, 0);
  assert.ok(spectator.displayCards.every((entry) => entry.ownerId === null));
  const storytellerDisplay = state.displayCards.find((entry) => entry.ownerId === teller.id).displayId;
  const expectedVotes = {};
  others.forEach((player, index) => {
    let target = storytellerDisplay;
    if (index === others.length - 1) target = state.displayCards.find((entry) => entry.ownerId !== player.id && entry.ownerId !== teller.id).displayId;
    applyAction(state, player.id, { type: "submitVote", displayId: target }, { now: 4000 + index, random: fixedRandom });
    expectedVotes[player.id] = target;
    if (index < others.length - 1) {
      assert.equal(buildView(state, player.id).roundResult, null);
      assert.equal(buildSpectatorView(state).roundResult, null);
    }
  });
  assert.equal(state.phase, "resolution");
  const resolved = buildSpectatorView(state);
  assert.ok(resolved.displayCards.every((entry) => entry.ownerId));
  assert.deepEqual(resolved.roundResult.votes, expectedVotes);
  assert.deepEqual(buildView(state, teller.id).roundResult.votes, expectedVotes);
});

test("three-player round requires two distinct decoys and blocks voting for either own card", () => {
  const state = setup(3); const teller = submitStory(state);
  const others = state.players.filter((player) => player.id !== teller.id);
  assert.throws(() => applyAction(state, others[0].id, { type: "submitDecoys", cardIds: [others[0].hand[0].id] }, { now: 3000, random: fixedRandom }), /必须选择2张牌/);
  others.forEach((player, index) => applyAction(state, player.id, { type: "submitDecoys", cardIds: [player.hand[0].id, player.hand[1].id] }, { now: 3100 + index, random: fixedRandom }));
  const own = state.displayCards.find((entry) => entry.ownerId === others[0].id);
  assert.throws(() => applyAction(state, others[0].id, { type: "submitVote", displayId: own.displayId }, { now: 4000, random: fixedRandom }), /不能投给自己的画面/);
});

test("ordinary server updates expose only progress counts and persistence restores secrets", () => {
  const state = setup(4); const teller = submitStory(state);
  const actor = state.players.find((player) => player.id !== teller.id);
  const cardId = actor.hand[0].id;
  applyAction(state, actor.id, { type: "submitDecoys", cardIds: [cardId] }, { now: 3000, random: fixedRandom });
  const other = state.players.find((player) => ![teller.id, actor.id].includes(player.id));
  const otherView = buildView(state, other.id);
  assert.equal(otherView.submissionCount, 1);
  assert.equal(JSON.stringify(otherView).includes(cardId), false);
  const restored = restoreState(serializeState(state));
  assert.equal(restored.submissions[actor.id].cards[0].id, cardId);
});

test("timeouts authoritatively keep the dream moving", () => {
  const state = setup(4);
  assert.equal(handleTimeout(state, { now: state.deadline + 1, random: fixedRandom }), true);
  assert.equal(state.phase, "playersChoosing");
  assert.equal(state.clue.text, "一个没有说完的梦");
  assert.equal(handleTimeout(state, { now: state.deadline + 1, random: fixedRandom }), true);
  assert.equal(state.phase, "voting");
  assert.equal(handleTimeout(state, { now: state.deadline + 1, random: fixedRandom }), true);
  assert.equal(state.phase, "resolution");
});

test("revealed results remain public during a 90-second authoritative discussion", () => {
  const state = setup(4); const teller = submitStory(state);
  const others = state.players.filter((player) => player.id !== teller.id);
  others.forEach((player, index) => applyAction(state, player.id, {
    type: "submitDecoys", cardIds: [player.hand[0].id]
  }, { now: 3000 + index, random: fixedRandom }));
  const answer = state.displayCards.find((entry) => entry.ownerId === teller.id).displayId;
  others.forEach((player, index) => applyAction(state, player.id, {
    type: "submitVote", displayId: answer
  }, { now: 4000 + index, random: fixedRandom }));

  assert.equal(state.phase, "resolution");
  assert.equal(state.deadline, 4000 + others.length - 1 + RESOLUTION_SECONDS * 1000);
  assert.equal(handleTimeout(state, { now: state.deadline + 1, random: fixedRandom }), true);
  assert.equal(state.phase, "discussion");
  assert.equal(state.deadline, 4000 + others.length + RESOLUTION_SECONDS * 1000 + DISCUSSION_SECONDS * 1000);

  const discussionView = buildSpectatorView(state);
  assert.ok(discussionView.roundResult);
  assert.ok(discussionView.displayCards.every((entry) => entry.ownerId));
  assert.equal(buildView(state, "p1").permissions.canContinue, true);
  const guest = state.players.find((player) => !player.isHost);
  assert.equal(buildView(state, guest.id).permissions.canContinue, false);

  const previousRound = state.round;
  applyAction(state, "p1", { type: "continue" }, { now: state.deadline - 1000, random: fixedRandom });
  assert.equal(state.phase, "storytellerChoosing");
  assert.equal(state.round, previousRound + 1);
});

test("the host cannot skip directly from result reveal to the next round", () => {
  const state = setup(3); const teller = submitStory(state);
  const others = state.players.filter((player) => player.id !== teller.id);
  others.forEach((player, index) => applyAction(state, player.id, {
    type: "submitDecoys", cardIds: [player.hand[0].id, player.hand[1].id]
  }, { now: 3000 + index, random: fixedRandom }));
  const answer = state.displayCards.find((entry) => entry.ownerId === teller.id).displayId;
  others.forEach((player, index) => applyAction(state, player.id, {
    type: "submitVote", displayId: answer
  }, { now: 4000 + index, random: fixedRandom }));

  const currentRound = state.round;
  applyAction(state, "p1", { type: "continue" }, { now: 5000, random: fixedRandom });
  assert.equal(state.phase, "discussion");
  assert.equal(state.round, currentRound);
  assert.equal(state.deadline, 5000 + DISCUSSION_SECONDS * 1000);
});

test("only the host can end an active match and return everyone to a clean lobby", () => {
  const state = setup(4);
  const guest = state.players.find((player) => !player.isHost);
  assert.equal(buildView(state, "p1").permissions.canEnd, true);
  assert.equal(buildView(state, guest.id).permissions.canEnd, false);
  assert.throws(() => applyAction(state, guest.id, { type: "end" }, { now: 2000 }), /只有房主/);

  applyAction(state, "p1", { type: "end" }, { now: 2100 });
  assert.equal(state.phase, "lobby");
  assert.equal(state.deadline, 0);
  assert.equal(state.round, 0);
  assert.equal(state.deck.length, 0);
  assert.equal(state.discard.length, 0);
  assert.equal(state.storytellerId, null);
  assert.equal(state.displayCards.length, 0);
  assert.equal(state.presentationEvents.length, 0);
  assert.ok(state.players.every((player) => player.score === 0 && player.hand.length === 0));
  const hostView = buildView(state, "p1");
  assert.equal(hostView.permissions.canEnd, false);
  assert.equal(hostView.permissions.canStart, true);
});
