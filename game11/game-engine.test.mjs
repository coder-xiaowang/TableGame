import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

function readyLobby() {
  const state = engine.createLobby({
    capacity: 4,
    host: { id: "w1", name: "White Encryptor", connected: true }
  });
  engine.addPlayer(state, { id: "w2", name: "White Decoder", connected: true });
  engine.addPlayer(state, { id: "b1", name: "Black One", connected: true });
  engine.addPlayer(state, { id: "b2", name: "Black Two", connected: true });
  for (const [id, team] of [["w1", "white"], ["w2", "white"], ["b1", "black"], ["b2", "black"]]) {
    engine.applyAction(state, id, { type: "sit", team });
  }
  return state;
}

function startedGame(now = 1000) {
  const state = readyLobby();
  engine.applyAction(state, "w1", { type: "start" }, { now, random: () => 0 });
  return state;
}

test("game11 lobby teams, seats and host start are server rules", () => {
  const state = readyLobby();
  engine.applyAction(state, "w2", { type: "move", direction: -1 });
  assert.equal(state.players.find((player) => player.id === "w2").seat, 1);
  assert.equal(state.players.find((player) => player.id === "w1").seat, 2);
  assert.throws(
    () => engine.applyAction(state, "w2", { type: "start" }),
    (error) => error.code === "host_required" && error.status === 403
  );
  engine.applyAction(state, "w1", { type: "start" }, { now: 500, random: () => 0 });
  assert.equal(state.phase, "clue");
  assert.equal(state.round, 1);
  assert.equal(state.deadline, 500 + engine.CLUE_SECONDS * 1000);
});

test("game11 creates a genuinely player-specific secret view", () => {
  const state = startedGame();
  const encryptorView = engine.buildView(state, "w1");
  const teammateView = engine.buildView(state, "w2");
  const opponentView = engine.buildView(state, "b1");

  assert.deepEqual(encryptorView.code, state.code);
  assert.equal(teammateView.code, null);
  assert.equal(opponentView.code, null);
  assert.deepEqual(encryptorView.teams.white.keywords, state.teams.white.keywords);
  assert.deepEqual(teammateView.teams.white.keywords, state.teams.white.keywords);
  assert.deepEqual(opponentView.teams.black.keywords, state.teams.black.keywords);
  assert.deepEqual(opponentView.teams.white.keywords, []);
  assert.deepEqual(encryptorView.teams.black.keywords, []);
  assert.equal(encryptorView.permissions.canSubmitClues, true);
  assert.equal(teammateView.permissions.canSubmitClues, false);
  assert.equal("usedClues" in encryptorView.players.find((player) => player.id === "w2"), false);
  assert.ok(Array.isArray(teammateView.players.find((player) => player.id === "w2").usedClues));
  for (const forbidden of ["codeDeck", "guesses", "guessDrafts", "tiebreakGuesses"]) {
    assert.equal(forbidden in encryptorView, false);
  }
});

test("game11 only the encryptor may submit valid new clues", () => {
  const state = startedGame();
  assert.throws(
    () => engine.applyAction(state, "w2", { type: "clues", clues: ["甲", "乙", "丙"] }),
    (error) => error.code === "not_encryptor"
  );
  const keyword = state.teams.white.keywords[0];
  assert.throws(
    () => engine.applyAction(state, "w1", { type: "clues", clues: [keyword, "乙", "丙"] }),
    (error) => error.code === "invalid_clues"
  );
  engine.applyAction(state, "w1", { type: "clues", clues: ["alpha", "bravo", "charlie"] }, { now: 2000 });
  assert.equal(state.phase, "guess");
  assert.deepEqual(state.players[0].usedClues, ["alpha", "bravo", "charlie"]);
  assert.ok(engine.buildView(state, "w1").players[0].usedClues.length === 3);
  assert.equal(engine.buildView(state, "w2").players[0].usedClues, undefined);
  assert.equal(engine.buildView(state, "w1").code, null);
});

test("game11 gives each guess submitter only their own private draft", () => {
  const state = startedGame();
  engine.applyAction(state, "w1", { type: "clues", clues: ["alpha", "bravo", "charlie"] }, { now: 2000 });
  state.round = 2;
  engine.applyAction(state, "w2", { type: "guessDraft", code: [1, 2, 3] });
  engine.applyAction(state, "b2", { type: "guessDraft", code: [4, 3, 2] });

  const decodeView = engine.buildView(state, "w2");
  const interceptView = engine.buildView(state, "b2");
  const hostView = engine.buildView(state, "w1");
  assert.deepEqual(decodeView.guessDraft, [1, 2, 3]);
  assert.deepEqual(interceptView.guessDraft, [4, 3, 2]);
  assert.equal(hostView.guessDraft, null);
  assert.equal(decodeView.permissions.guessRole, "decode");
  assert.equal(interceptView.permissions.guessRole, "intercept");
  assert.equal(hostView.permissions.guessRole, null);
});

test("game11 reveal makes code and guesses public only through the record", () => {
  const state = startedGame();
  const code = [...state.code];
  engine.applyAction(state, "w1", { type: "clues", clues: ["alpha", "bravo", "charlie"] }, { now: 2000 });
  engine.applyAction(state, "w2", { type: "guess", code }, { now: 3000 });
  assert.equal(state.phase, "reveal");
  for (const id of ["w1", "w2", "b1", "b2"]) {
    const view = engine.buildView(state, id);
    assert.deepEqual(view.code, code);
    assert.deepEqual(view.records[0].decodeGuess, code);
    assert.equal(view.records[0].interceptGuess, null);
  }
});

test("game11 deadlines submit system clues, lock drafts and advance reveal", () => {
  const state = startedGame(0);
  assert.equal(engine.handleTimeout(state, { now: state.deadline }), true);
  assert.equal(state.phase, "guess");
  assert.deepEqual(state.clues, ["提示超时一", "提示超时二", "提示超时三"]);
  engine.applyAction(state, "w2", { type: "guessDraft", code: [1, 2, 3] });
  assert.equal(engine.handleTimeout(state, { now: state.deadline }), true);
  assert.equal(state.phase, "reveal");
  assert.deepEqual(state.records[0].decodeGuess, [1, 2, 3]);
  assert.equal(engine.handleTimeout(state, { now: state.deadline }), true);
  assert.equal(state.phase, "clue");
  assert.equal(state.turnTeam, "black");
});

test("game11 tiebreak answers stay private until both teams finish", () => {
  const state = startedGame();
  state.phase = "tiebreak";
  state.deadline = 100_000;
  state.tiebreakGuesses = { white: null, black: null };
  engine.applyAction(state, "w2", { type:"tiebreak", words:["甲","乙","丙","丁"] });
  const hostView = engine.buildView(state, "w1");
  const blackView = engine.buildView(state, "b2");
  assert.equal("tiebreakGuesses" in hostView, false);
  assert.equal("tiebreakGuesses" in blackView, false);
  assert.equal(hostView.tiebreakStatus.white, true);
  assert.equal(blackView.tiebreakStatus.white, true);
  engine.applyAction(state, "b2", { type:"tiebreak", words:["戊","己","庚","辛"] });
  assert.equal(state.phase, "ended");
  const endedView = engine.buildView(state, "b1");
  assert.equal(endedView.teams.white.keywords.length, 4);
  assert.equal(endedView.teams.black.keywords.length, 4);
});

test("game11 persisted secret state is cloned and version checked", () => {
  const state = startedGame();
  const serialized = engine.serializeState(state);
  serialized.teams.white.keywords[0] = "只修改快照";
  assert.notEqual(state.teams.white.keywords[0], "只修改快照");
  assert.deepEqual(engine.restoreState(engine.serializeState(state)), state);
  assert.throws(
    () => engine.restoreState({ ...serialized, stateVersion: 999 }),
    /Unsupported game11 state version/
  );
});

test("game11 spectator phase matrix protects both teams and releases lobby seats safely", () => {
  const lobby = readyLobby();
  assert.equal(engine.SUPPORTS_SPECTATORS, true);
  assert.equal(engine.canChangeSeats(lobby), true);
  assert.throws(
    () => engine.vacateSeat(lobby, "w1"),
    (error) => error.code === "invalid_seat_target" && error.status === 403
  );
  const removed = engine.vacateSeat(lobby, "w2");
  assert.equal(removed.team, "white");
  assert.deepEqual(lobby.players.filter((player) => player.team === "white").map((player) => player.seat), [1]);

  const state = startedGame();
  let spectator = engine.buildSpectatorView(state);
  assert.equal(spectator.selfId, null);
  assert.deepEqual(spectator.teams.white.keywords, []);
  assert.deepEqual(spectator.teams.black.keywords, []);
  assert.equal(spectator.code, null);
  assert.equal(spectator.guessDraft, null);
  assert.ok(spectator.players.every((player) => !("usedClues" in player)));
  assert.ok(Object.values(spectator.permissions).every((value) => value === false || value === null));
  assert.equal(engine.canChangeSeats(state), false);

  engine.applyAction(state, "w1", { type:"clues", clues:["alpha","bravo","charlie"] }, { now:2000 });
  state.round = 2;
  engine.applyAction(state, "w2", { type:"guessDraft", code:[1,2,3] });
  engine.applyAction(state, "b2", { type:"guessDraft", code:[4,3,2] });
  spectator = engine.buildSpectatorView(state);
  assert.deepEqual(spectator.clues, ["alpha","bravo","charlie"]);
  assert.equal(spectator.code, null);
  assert.equal(spectator.guessDraft, null);
  assert.deepEqual(spectator.guessStatus, { decode:false, intercept:false });
  engine.applyAction(state, "w2", { type:"guess", code:[1,2,3] });
  spectator = engine.buildSpectatorView(state);
  assert.deepEqual(spectator.guessStatus, { decode:true, intercept:false });
  assert.equal(spectator.guessDraft, null);
  assert.equal(spectator.code, null);
  engine.applyAction(state, "b2", { type:"guess", code:[4,3,2] }, { now:3000 });
  spectator = engine.buildSpectatorView(state);
  assert.equal(spectator.phase, "reveal");
  assert.deepEqual(spectator.code, state.code);
  assert.deepEqual(spectator.records[0].decodeGuess, [1,2,3]);
  assert.deepEqual(spectator.records[0].interceptGuess, [4,3,2]);

  state.phase = "tiebreak";
  state.tiebreakGuesses = { white:null, black:null };
  engine.applyAction(state, "w2", { type:"tiebreak", words:["甲","乙","丙","丁"] });
  spectator = engine.buildSpectatorView(state);
  assert.deepEqual(spectator.tiebreakStatus, { white:true, black:false });
  assert.equal("tiebreakGuesses" in spectator, false);
  assert.deepEqual(spectator.teams.white.keywords, []);
  assert.deepEqual(spectator.teams.black.keywords, []);
  engine.applyAction(state, "b2", { type:"tiebreak", words:["戊","己","庚","辛"] });
  spectator = engine.buildSpectatorView(state);
  assert.equal(spectator.phase, "ended");
  assert.equal(spectator.teams.white.keywords.length, 4);
  assert.equal(spectator.teams.black.keywords.length, 4);
});
