import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

function readyState() {
  const state = engine.createLobby({capacity:2,host:{id:"p1",name:"甲",connected:true}});
  engine.addPlayer(state,{id:"p2",name:"乙",connected:true});
  engine.applyAction(state,"p1",{type:"start"},{now:1000,random:() => 0.314159});
  return state;
}

test("server deals unique cards and redacts every other hand",() => {
  const state = readyState();
  const allCards = [...state.rows.flat(),...state.players.flatMap((player) => player.hand)];
  assert.equal(allCards.length,24);
  assert.equal(new Set(allCards).size,24);
  const first = engine.buildView(state,"p1");
  const second = engine.buildView(state,"p2");
  assert.ok(first.players[0].hand.every(Number.isInteger));
  assert.ok(first.players[1].hand.every((card) => card === null));
  assert.ok(second.players[0].hand.every((card) => card === null));
  assert.equal("playQueue" in first,false);
});

test("spectator view independently redacts every hand and secret selection",() => {
  const state = readyState();
  const chosen = state.players[0].hand[0];
  engine.applyAction(state,"p1",{type:"selectCard",card:chosen},{now:2000});
  const spectator = engine.buildSpectatorView(state);
  assert.equal(spectator.selfId,null);
  assert.equal(spectator.players[0].hasSelected,true);
  assert.equal(spectator.players[0].selectedCard,null);
  assert.ok(spectator.players.every((player) => player.hand.every((card) => card === null)));
  assert.equal("playQueue" in spectator,false);
  assert.deepEqual(spectator.permissions,{
    canManage:false,canKick:false,canSetCapacity:false,canStart:false,
    canEnd:false,canSelect:false,canChooseRow:false
  });
});

test("only a non-host player can voluntarily vacate a lobby seat",() => {
  const state = engine.createLobby({capacity:3,host:{id:"p1",name:"甲",connected:true}});
  engine.addPlayer(state,{id:"p2",name:"乙",connected:true});
  assert.equal(engine.canChangeSeats(state),true);
  assert.throws(() => engine.vacateSeat(state,"p1"),(error) => error.code === "invalid_seat_target");
  const removed = engine.vacateSeat(state,"p2",{now:2000});
  assert.equal(removed.id,"p2");
  assert.deepEqual(state.players.map(({id}) => id),["p1"]);
  engine.addPlayer(state,{id:"p2",name:"乙",connected:true});
  engine.applyAction(state,"p1",{type:"setCapacity",capacity:2});
  engine.applyAction(state,"p1",{type:"start"},{now:3000,random:() => 0.2});
  assert.equal(engine.canChangeSeats(state),false);
  assert.throws(() => engine.vacateSeat(state,"p2"),(error) => error.code === "seat_change_unavailable");
});

test("selected cards remain private until all players lock and server resolves in ascending order",() => {
  const state = readyState();
  state.turn = 10;
  state.rows = [[10],[30],[50],[70]];
  state.players[0].hand = [41];
  state.players[1].hand = [61];
  engine.applyAction(state,"p1",{type:"selectCard",card:41},{now:2000});
  const opponentView = engine.buildView(state,"p2");
  assert.equal(opponentView.players[0].hasSelected,true);
  assert.equal(opponentView.players[0].selectedCard,null);
  assert.deepEqual(opponentView.players[0].hand,[null]);
  engine.applyAction(state,"p2",{type:"selectCard",card:61},{now:2100});
  assert.equal(state.phase,"revealing");
  assert.deepEqual(state.rows,[[10],[30],[50],[70]]);
  assert.deepEqual(state.revealedPlays.map(({card,status}) => ({card,status})),[
    {card:41,status:"waiting"},{card:61,status:"waiting"}
  ]);
  engine.handleTimeout(state,{now:state.deadline});
  assert.equal(state.phase,"placing");
  assert.equal(state.animation.card,41);
  assert.equal(state.animation.rowIndex,1);
  assert.deepEqual(state.rows,[[10],[30],[50],[70]]);
  engine.handleTimeout(state,{now:state.deadline});
  assert.equal(state.animation.card,61);
  assert.deepEqual(state.rows,[[10],[30,41],[50],[70]]);
  engine.handleTimeout(state,{now:state.deadline});
  assert.equal(state.phase,"turnEnding");
  assert.deepEqual(state.rows,[[10],[30,41],[50,61],[70]]);
  engine.handleTimeout(state,{now:state.deadline});
  assert.equal(state.phase,"roundEnd");
  assert.match(state.logs[0].text,/第 1 局结束/);
  assert.match(state.logs[1].text,/甲 41，乙 61/);
});

test("sixth card captures a row while too-small card waits for an authorized choice",() => {
  const state = readyState();
  state.turn = 1;
  state.rows = [[10,11,12,13,14],[30],[50],[70]];
  state.players[0].hand = [15];
  state.players[1].hand = [5];
  engine.applyAction(state,"p1",{type:"selectCard",card:15},{now:2000});
  engine.applyAction(state,"p2",{type:"selectCard",card:5},{now:2000});
  assert.equal(state.phase,"revealing");
  engine.handleTimeout(state,{now:state.deadline});
  assert.equal(state.phase,"choosingRow");
  assert.equal(state.pendingPlayerId,"p2");
  assert.equal(state.pendingCard,5);
  assert.throws(() => engine.applyAction(state,"p1",{type:"chooseRow",rowIndex:1},{now:2100}),/当前不需要你/);
  engine.applyAction(state,"p2",{type:"chooseRow",rowIndex:1},{now:2200});
  assert.equal(state.phase,"placing");
  assert.equal(state.animation.type,"captureAndPlace");
  assert.equal(state.animation.points,3);
  assert.deepEqual(state.rows[1],[30]);
  engine.handleTimeout(state,{now:state.deadline});
  assert.deepEqual(state.rows[1],[5]);
  assert.equal(state.animation.type,"captureAndPlace");
  assert.equal(state.animation.points,11);
  assert.equal(state.players[0].captured.length,0);
  engine.handleTimeout(state,{now:state.deadline});
  assert.deepEqual(state.rows[0],[15]);
  assert.equal(state.players[1].captured.includes(30),true);
  assert.equal(state.players[0].captured.length,5);
});

test("selection and row-choice deadlines are executed by the server",() => {
  const state = readyState();
  const deadline = state.deadline;
  assert.equal(engine.handleTimeout(state,{now:deadline-1,random:() => 0}),false);
  assert.equal(engine.handleTimeout(state,{now:deadline,random:() => 0}),true);
  assert.equal(state.phase,"revealing");
  engine.handleTimeout(state,{now:state.deadline,random:() => 0});
  if (state.phase === "choosingRow") {
    const rowDeadline = state.deadline;
    assert.equal(engine.handleTimeout(state,{now:rowDeadline,random:() => 0}),true);
  }
  while (["placing","choosingRow","turnEnding"].includes(state.phase)) {
    assert.equal(engine.handleTimeout(state,{now:state.deadline,random:() => 0}),true);
  }
  assert.equal(state.phase,"selecting");
  assert.equal(state.turn,2);
});

test("disconnect substitutes only the missing secret action",() => {
  const state = readyState();
  const ownCard = state.players[0].hand[0];
  engine.applyAction(state,"p1",{type:"selectCard",card:ownCard},{now:2000});
  engine.setPresence(state,"p2",false,{now:2100,random:() => 0});
  assert.equal(state.players[1].connected,false);
  assert.notEqual(state.phase,"resolving");
  assert.ok(state.logs.some((entry) => entry.text.includes("离线")));
});

test("scores persist into the next round and manual end clears them",() => {
  const state = readyState();
  state.phase = "roundEnd";
  state.deadline = 0;
  state.players[0].score = 17;
  engine.applyAction(state,"p1",{type:"start"},{now:3000,random:() => 0.2});
  assert.equal(state.round,2);
  assert.equal(state.players[0].score,17);
  engine.applyAction(state,"p1",{type:"end"},{now:4000});
  assert.equal(state.phase,"lobby");
  assert.ok(state.players.every((player) => player.score === 0 && player.hand.length === 0));
});

test("serialized state restores the pending secret selection",() => {
  const state = readyState();
  const card = state.players[0].hand[0];
  engine.applyAction(state,"p1",{type:"selectCard",card},{now:2000});
  const restored = engine.restoreState(engine.serializeState(state));
  assert.equal(restored.players[0].selectedCard,card);
  assert.equal(engine.buildView(restored,"p2").players[0].selectedCard,null);
});

test("a restored in-flight animation commits once and continues the public queue",() => {
  const state = readyState();
  state.rows = [[10],[30],[50],[70]];
  state.players[0].hand = [41];
  state.players[1].hand = [61];
  engine.applyAction(state,"p1",{type:"selectCard",card:41},{now:2000});
  engine.applyAction(state,"p2",{type:"selectCard",card:61},{now:2000});
  engine.handleTimeout(state,{now:state.deadline});
  const animationId = state.animation.id;
  const restored = engine.restoreState(engine.serializeState(state));
  assert.equal(restored.animation.id,animationId);
  assert.deepEqual(restored.rows[1],[30]);
  assert.equal(engine.handleTimeout(restored,{now:restored.deadline}),true);
  assert.deepEqual(restored.rows[1],[30,41]);
  assert.equal(restored.revealedPlays[0].status,"done");
  assert.equal(restored.animation.card,61);
  assert.equal(engine.handleTimeout(restored,{now:restored.deadline-1}),false);
  assert.deepEqual(restored.rows[1],[30,41]);
});
