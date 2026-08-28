"use strict";

const assert=require("node:assert/strict");
const test=require("node:test");

test("failed multi-card match waits for an authoritative left/right placement",async()=>{
  const engine=await import("./server/game-engine.mjs");
  const state=engine.createLobby({capacity:2,host:{id:"p1",name:"甲",connected:true}});
  engine.addPlayer(state,{id:"p2",name:"乙",connected:true});
  engine.applyAction(state,"p1",{type:"start"},{now:1_000,random:()=>0.5});
  engine.applyAction(state,"p1",{type:"initialPeek",slotIds:state.players[0].slots.slice(0,2).map((slot)=>slot.slotId)},{now:2_000});
  engine.applyAction(state,"p2",{type:"initialPeek",slotIds:state.players[1].slots.slice(0,2).map((slot)=>slot.slotId)},{now:2_000});
  engine.handleTimeout(state,{now:state.deadline});

  const actor=state.players[0];
  actor.slots[0].card.value=1;
  actor.slots[1].card.value=2;
  const selected=actor.slots.slice(0,2);
  const originalCount=actor.slots.length;
  engine.applyAction(state,"p1",{type:"drawDeck"},{now:3_000});
  const incomingId=state.pending.card.id;
  engine.applyAction(state,"p1",{type:"exchange",slotIds:selected.map((slot)=>slot.slotId)},{now:4_000});

  assert.equal(state.phase,"failedExchange");
  assert.equal(actor.slots.length,originalCount);
  assert.ok(selected.every((slot)=>slot.faceUp));
  assert.equal(state.pending.card.id,incomingId);
  assert.equal(engine.buildView(state,"p1").permissions.canPlaceFailedExchange,true);
  assert.equal(engine.buildView(state,"p2").permissions.canPlaceFailedExchange,false);
  assert.throws(()=>engine.applyAction(state,"p2",{type:"placeFailedExchange",end:"left"},{now:4_500}),/还没有轮到你/);

  const timedOut=engine.restoreState(engine.serializeState(state));
  engine.handleTimeout(timedOut,{now:timedOut.deadline});
  assert.equal(timedOut.players[0].slots.at(-1).card.id,incomingId);
  assert.equal(timedOut.pending,null);

  const restored=engine.restoreState(engine.serializeState(state));
  engine.applyAction(restored,"p1",{type:"placeFailedExchange",end:"left"},{now:5_000});
  assert.equal(restored.phase,"turn");
  assert.equal(restored.players[0].slots.length,originalCount+1);
  assert.equal(restored.players[0].slots[0].card.id,incomingId);
  assert.equal(restored.pending,null);
  engine.validateState(restored);
});
