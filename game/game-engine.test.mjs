import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

function readyLobby(count = 3) {
  const state = engine.createLobby({
    capacity: 32,
    host: { id: "p1", name: "甲", connected: true }
  });
  for (let index = 2; index <= count; index += 1) {
    engine.addPlayer(state, { id: `p${index}`, name: `玩家${index}`, connected: true });
  }
  return state;
}

function startedLibrary(count = 3) {
  const state = readyLobby(count);
  engine.applyAction(state, "p1", {
    type: "configure", gameMode: "library", topic: "动物"
  });
  engine.applyAction(state, "p1", { type: "start" }, { now: 1_000, random: () => 0 });
  return state;
}

function collectingWords({ count = 3, playerWordMode = "single", wordExtraMode = "none" } = {}) {
  const state = readyLobby(count);
  engine.applyAction(state, "p1", {
    type: "configure", gameMode: "playerWords", playerWordMode, wordExtraMode
  });
  engine.applyAction(state, "p1", { type: "start" });
  return state;
}

test("game room settings and start permission are enforced by the server", () => {
  const state = readyLobby(2);
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "configure", gameMode: "library", topic: "动物" }),
    (error) => error.code === "host_required" && error.status === 403
  );
  assert.throws(
    () => engine.applyAction(state, "p1", {
      type: "configure", gameMode: "playerWords", playerWordMode: "trap", wordExtraMode: "hint"
    }),
    (error) => error.code === "incompatible_modes"
  );
  engine.setPresence(state, "p2", false);
  assert.throws(
    () => engine.applyAction(state, "p1", { type: "start" }),
    (error) => error.code === "players_offline"
  );
});

test("game library words are allocated by the server and individually hidden", () => {
  const state = startedLibrary();
  assert.equal(state.phase, "playing");
  assert.equal(new Set(state.players.map((player) => player.word)).size, 3);

  for (const viewer of state.players) {
    const view = engine.buildView(state, viewer.id);
    assert.equal(view.words.find((word) => word.id === viewer.id).word, null);
    assert.ok(view.words.filter((word) => word.id !== viewer.id).every((word) => word.word));
    assert.equal("submittedEntries" in view, false);
  }
  assert.notDeepEqual(engine.buildView(state, "p1"), engine.buildView(state, "p2"));
});

test("game keeps player submissions secret and deranges the final assignment", () => {
  const state = collectingWords({ playerWordMode: "trap", wordExtraMode: "forbidden" });
  const submissions = {
    p1: { word: "答案甲", trapWord: "陷阱甲", extra: "禁问甲" },
    p2: { word: "答案乙", trapWord: "陷阱乙", extra: "禁问乙" },
    p3: { word: "答案丙", trapWord: "陷阱丙", extra: "禁问丙" }
  };
  engine.applyAction(state, "p1", { type: "submitWord", ...submissions.p1 });
  engine.applyAction(state, "p2", { type: "submitWord", ...submissions.p2 });

  const collectingView = engine.buildView(state, "p3");
  assert.deepEqual(new Set(collectingView.submittedPlayerIds), new Set(["p1", "p2"]));
  assert.equal(JSON.stringify(collectingView).includes("答案甲"), false);
  assert.equal(JSON.stringify(collectingView).includes("禁问乙"), false);

  engine.applyAction(state, "p3", { type: "submitWord", ...submissions.p3 }, { random: () => 0 });
  assert.equal(state.phase, "playing");
  for (const player of state.players) {
    assert.notEqual(player.word, submissions[player.id].word);
    const ownView = engine.buildView(state, player.id);
    const ownWord = ownView.words.find((word) => word.id === player.id);
    assert.equal(ownWord.word, null);
    assert.equal(ownWord.trapWord, null);
    assert.ok(ownWord.extra);
  }
});

test("game question and answer permissions are authoritative", () => {
  const state = startedLibrary();
  assert.equal(state.currentPlayerId, "p1");
  assert.throws(
    () => engine.applyAction(state, "p2", { type: "question", text: "我是动物吗？" }),
    (error) => error.code === "not_your_turn"
  );
  engine.applyAction(state, "p1", { type: "question", text: "我是动物吗？" });
  assert.throws(
    () => engine.applyAction(state, "p1", { type: "answer", answer: "yes" }),
    (error) => error.code === "answer_unavailable"
  );
  engine.applyAction(state, "p2", { type: "answer", answer: "yes" });
  assert.ok(state.currentQuestion);
  engine.applyAction(state, "p3", { type: "answer", answer: "maybe" });
  assert.equal(state.currentQuestion, null);
  assert.equal(state.turnQuestionAsked, true);
  assert.throws(
    () => engine.applyAction(state, "p1", { type: "question", text: "还能再问吗？" }),
    (error) => error.code === "question_unavailable"
  );
});

test("game guesses, traps, turn order and final survivor are server decisions", () => {
  const state = collectingWords({ playerWordMode: "trap" });
  for (const [index, id] of ["p1", "p2", "p3"].entries()) {
    engine.applyAction(state, id, {
      type: "submitWord", word: `答案${index}`, trapWord: `陷阱${index}`
    }, { random: () => 0 });
  }
  assert.equal(state.currentPlayerId, "p1");
  engine.applyAction(state, "p1", { type: "guess", text: state.players[0].trapWord });
  assert.equal(state.players[0].status, "eliminated");
  assert.equal(state.currentPlayerId, "p2");
  engine.applyAction(state, "p2", { type: "guess", text: state.players[1].word });
  assert.equal(state.players[1].status, "won");
  assert.equal(state.phase, "ended");
  assert.equal(state.players[2].status, "left");
  assert.deepEqual(state.winners, ["p2"]);
});

test("game wrong guesses and skips advance in seating order and increment rounds", () => {
  const state = startedLibrary();
  engine.applyAction(state, "p1", { type: "guess", text: "肯定不对" });
  assert.equal(state.currentPlayerId, "p2");
  engine.applyAction(state, "p2", { type: "skip" });
  assert.equal(state.currentPlayerId, "p3");
  engine.applyAction(state, "p3", { type: "skip" });
  assert.equal(state.currentPlayerId, "p1");
  assert.equal(state.round, 2);
});

test("game disconnect and kick preserve the next seat", () => {
  const disconnected = startedLibrary(4);
  engine.setPresence(disconnected, "p1", false);
  assert.equal(disconnected.currentPlayerId, "p2");

  const kicked = startedLibrary(4);
  engine.removePlayer(kicked, "p1", "p2");
  assert.equal(kicked.currentPlayerId, "p1");
  assert.throws(
    () => engine.removePlayer(kicked, "p1", "p1"),
    (error) => error.code === "invalid_kick_target"
  );
});

test("game rejects actions from a player who has not reconnected after recovery", () => {
  const state = startedLibrary();
  state.players.forEach((player) => { player.connected = false; });
  assert.throws(
    () => engine.applyAction(state, "p1", { type: "skip" }),
    (error) => error.code === "not_active"
  );
});

test("game removes the current kicked player without losing seating order", () => {
  const state = startedLibrary(4);
  engine.applyAction(state, "p1", { type: "skip" });
  assert.equal(state.currentPlayerId, "p2");
  engine.removePlayer(state, "p1", "p2");
  assert.equal(state.currentPlayerId, "p3");
});

test("game persisted state is cloned and version checked", () => {
  const state = startedLibrary();
  const serialized = engine.serializeState(state);
  serialized.players[0].word = "只修改快照";
  assert.notEqual(state.players[0].word, "只修改快照");
  assert.deepEqual(engine.restoreState(engine.serializeState(state)), state);
  assert.throws(
    () => engine.restoreState({ ...serialized, stateVersion: 999 }),
    /Unsupported game state version/
  );
});
