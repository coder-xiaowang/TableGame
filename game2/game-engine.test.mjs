import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

function readyLobby(capacity = 4) {
  const state = engine.createLobby({
    capacity,
    host:{id:"p1",name:"甲",connected:true}
  });
  for (let index = 2; index <= capacity; index += 1) {
    engine.addPlayer(state,{id:`p${index}`,name:`玩家${index}`,connected:true});
  }
  const seatOrder = capacity === 4 ? ["p2","p1","p3","p4"] : Array.from({length:capacity},(_,index) => `p${index + 1}`);
  seatOrder.forEach((id,seatIndex) => engine.applyAction(state,id,{type:"sit",seatIndex}));
  return state;
}

function startedGame() {
  const state = readyLobby(4);
  engine.applyAction(state,"p1",{type:"start"},{now:1_000,random:() => 0});
  return state;
}

test("game2 lobby capacity, seats and host start are server rules", () => {
  const state = engine.createLobby({capacity:4,host:{id:"p1",name:"甲",connected:true}});
  engine.addPlayer(state,{id:"p2",name:"乙",connected:true});
  assert.throws(
    () => engine.applyAction(state,"p2",{type:"setCapacity",capacity:2}),
    (error) => error.code === "host_required" && error.status === 403
  );
  assert.throws(
    () => engine.applyAction(state,"p1",{type:"start"}),
    (error) => error.code === "players_missing"
  );
  engine.applyAction(state,"p1",{type:"setCapacity",capacity:2});
  engine.applyAction(state,"p1",{type:"sit",seatIndex:0});
  assert.throws(
    () => engine.applyAction(state,"p2",{type:"sit",seatIndex:0}),
    (error) => error.code === "seat_taken"
  );
  engine.applyAction(state,"p2",{type:"sit",seatIndex:1});
  engine.applyAction(state,"p1",{type:"start"},{random:() => 0});
  assert.equal(state.phase,"playing");
});

test("game2 sends captain and member genuinely different secret views", () => {
  const state = startedGame();
  const memberHostView = engine.buildView(state,"p1");
  const currentCaptainView = engine.buildView(state,"p2");
  const otherCaptainView = engine.buildView(state,"p3");
  const otherMemberView = engine.buildView(state,"p4");

  assert.equal(memberHostView.idiom,"");
  assert.equal(memberHostView.idiomHidden,true);
  assert.equal(currentCaptainView.idiom,state.idiom);
  assert.equal(otherCaptainView.idiom,state.idiom);
  assert.equal(otherMemberView.idiom,"");
  assert.equal(memberHostView.permissions.canManage,true);
  assert.equal(memberHostView.permissions.canDescribe,false);
  assert.equal(currentCaptainView.permissions.canDescribe,true);
  for (const view of [memberHostView,currentCaptainView,otherCaptainView,otherMemberView]) {
    assert.equal("idiomDeck" in view,false);
  }
  assert.notDeepEqual(memberHostView,currentCaptainView);
});

test("game2 only the current captain and member may act", () => {
  const state = startedGame();
  assert.equal(engine.buildView(state,"p2").permissions.canDescribe,true);
  assert.throws(
    () => engine.applyAction(state,"p3",{type:"describe",text:"一段描述"}),
    (error) => error.code === "not_your_turn"
  );
  engine.applyAction(state,"p2",{type:"describe",text:"和绘画有关"},{now:2_000});
  assert.equal(state.turnPhase,"guess");
  assert.equal(state.currentDescription,"和绘画有关");
  assert.equal(engine.buildView(state,"p1").permissions.canGuess,true);
  assert.throws(
    () => engine.applyAction(state,"p2",{type:"guess",text:state.idiom}),
    (error) => error.code === "not_your_turn"
  );
});

test("game2 wrong guesses rotate teams and complete a question round", () => {
  const state = startedGame();
  engine.applyAction(state,"p2",{type:"describe",text:"第一队描述"});
  engine.applyAction(state,"p1",{type:"guess",text:"肯定错误"});
  assert.equal(state.turnTeamIndex,1);
  assert.equal(state.round,1);
  engine.applyAction(state,"p3",{type:"describe",text:"第二队描述"});
  engine.applyAction(state,"p4",{type:"guess",text:"仍然错误"});
  assert.equal(state.turnTeamIndex,0);
  assert.equal(state.round,2);
  assert.equal(state.turnPhase,"describe");
});

test("game2 correct guesses score and start a fresh idiom at the next team", () => {
  const state = startedGame();
  const firstIdiom = state.idiom;
  engine.applyAction(state,"p2",{type:"describe",text:"请猜第一题"});
  engine.applyAction(state,"p1",{type:"guess",text:firstIdiom},{now:3_000,random:() => 0});
  assert.deepEqual(state.scores,[1,0]);
  assert.equal(state.wordNumber,2);
  assert.equal(state.turnTeamIndex,1);
  assert.equal(state.round,1);
  assert.notEqual(state.idiom,firstIdiom);
  assert.equal(state.log[0].text,"第 1 队获得 1 分，开始第 2 题");
});

test("game2 disconnects skip incomplete teams and recovery cannot act offline", () => {
  const state = startedGame();
  engine.setPresence(state,"p2",false);
  assert.equal(state.turnTeamIndex,1);
  assert.equal(engine.buildView(state,"p3").permissions.canDescribe,true);
  engine.setPresence(state,"p3",false);
  assert.equal(engine.buildView(state,"p1").currentActorId,null);
  assert.throws(
    () => engine.applyAction(state,"p3",{type:"describe",text:"离线操作"}),
    (error) => error.code === "not_connected"
  );
  engine.setPresence(state,"p2",true);
  assert.equal(state.turnTeamIndex,0);
  assert.equal(engine.buildView(state,"p2").permissions.canDescribe,true);
});

test("game2 a kick during play ends the match and reveals the last answer", () => {
  const state = startedGame();
  engine.removePlayer(state,"p1","p3",{now:5_000});
  assert.equal(state.phase,"ended");
  assert.equal(state.players.some((player) => player.id === "p3"),false);
  assert.equal(engine.buildView(state,"p4").idiom,state.idiom);
  assert.match(state.log[0].text,/大局结束/);
});

test("game2 host ending, result ranking and returning to lobby are authoritative", () => {
  const state = startedGame();
  state.scores = [2,2];
  assert.throws(
    () => engine.applyAction(state,"p2",{type:"end"}),
    (error) => error.code === "host_required"
  );
  engine.applyAction(state,"p1",{type:"end"},{now:6_000});
  const ended = engine.buildView(state,"p4");
  assert.equal(ended.phase,"ended");
  assert.match(ended.notice,/并列第一/);
  engine.applyAction(state,"p1",{type:"restart"});
  assert.equal(state.phase,"lobby");
  assert.deepEqual(state.scores,[0,0]);
  assert.ok(state.players.every((player) => Number.isInteger(player.seatIndex)));
});

test("game2 persisted secret state is cloned and version checked", () => {
  const state = startedGame();
  const serialized = engine.serializeState(state);
  serialized.idiom = "只改快照";
  serialized.idiomDeck.pop();
  assert.notEqual(state.idiom,"只改快照");
  assert.notEqual(serialized.idiomDeck.length,state.idiomDeck.length);
  assert.deepEqual(engine.restoreState(engine.serializeState(state)),state);
  assert.throws(
    () => engine.restoreState({...serialized,stateVersion:999}),
    /Unsupported game2 state version/
  );
});
