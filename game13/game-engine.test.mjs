import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

function started(count=2){
  const state=engine.createLobby({capacity:count,host:{id:"p1",name:"甲",connected:true}});
  for(let index=2;index<=count;index+=1)engine.addPlayer(state,{id:`p${index}`,name:`玩家${index}`,connected:true});
  engine.applyAction(state,"p1",{type:"start"},{now:1000,random:()=>.37});return state;
}
function finishInitial(state,now=2000){
  for(const player of state.players)engine.applyAction(state,player.id,{type:"initialPeek",slotIds:player.slots.slice(0,2).map((slot)=>slot.slotId)},{now});
  engine.handleTimeout(state,{now:now+5000});
}
const card=(id,value)=>({id,value,power:value>=7&&value<=8?"peek":value>=9&&value<=10?"spy":value>=11&&value<=12?"swap":null});
function rigDrawn(state,{actor=state.players[0],drawn=card("drawn",2),source="deck"}={}){state.phase="drawn";state.currentIndex=state.players.indexOf(actor);state.pending={card:drawn,source};state.deadline=99999;}

test("server owns all cards and initial peek is private per player",()=>{
  const state=started();engine.validateState(state);
  const p1=state.players[0];
  engine.applyAction(state,"p1",{type:"initialPeek",slotIds:p1.slots.slice(0,2).map((slot)=>slot.slotId)},{now:2000});
  const first=engine.buildView(state,"p1"),second=engine.buildView(state,"p2");
  assert.equal(first.players[0].slots.filter((slot)=>slot.value!==null).length,2);
  assert.equal(second.players[0].slots.every((slot)=>slot.value===null),true);
  assert.equal(second.players.flatMap((player)=>player.slots).some((slot)=>"card" in slot),false);
});

test("deck draw is visible only to the actor and discard draw must be exchanged",()=>{
  const state=started();finishInitial(state);
  engine.applyAction(state,"p1",{type:"drawDeck"},{now:8000});
  assert.ok(engine.buildView(state,"p1").pendingCard);
  assert.equal(engine.buildView(state,"p2").pendingCard,null);
  engine.applyAction(state,"p1",{type:"discardDrawn"},{now:8100});
  state.currentIndex=0;state.phase="turn";state.deadline=9000;
  engine.applyAction(state,"p1",{type:"drawDiscard"},{now:8200});
  assert.throws(()=>engine.applyAction(state,"p1",{type:"discardDrawn"},{now:8300}),/必须用于交换/);
});

test("matching multiple equal cards removes them and inserts one incoming card",()=>{
  const state=started();const player=state.players[0];
  player.slots=[{slotId:"a",card:card("a",4),faceUp:false},{slotId:"b",card:card("b",4),faceUp:false},{slotId:"c",card:card("c",9),faceUp:false}];
  rigDrawn(state,{drawn:card("new",1)});
  engine.applyAction(state,"p1",{type:"exchange",slotIds:["a","b"]},{now:3000});
  assert.deepEqual(player.slots.map((slot)=>slot.card.value),[1,9]);
  assert.deepEqual(state.discard.slice(-2).map((item)=>item.value),[4,4]);
});

test("failed three-card match reveals selections and deals an unseen penalty",()=>{
  const state=started();const player=state.players[0];
  player.slots=[{slotId:"a",card:card("a",4),faceUp:false},{slotId:"b",card:card("b",4),faceUp:false},{slotId:"c",card:card("c",5),faceUp:false}];
  const beforeDeck=state.deck.length;rigDrawn(state,{drawn:card("new",1)});
  engine.applyAction(state,"p1",{type:"exchange",slotIds:["a","b","c"]},{now:3000});
  assert.equal(state.phase,"failedExchange");
  engine.applyAction(state,"p1",{type:"placeFailedExchange",end:"left"},{now:3100});
  assert.equal(player.slots.length,5);assert.ok(["a","b","c"].every((id)=>player.slots.find((slot)=>slot.slotId===id)?.faceUp));assert.equal(state.deck.length,beforeDeck-1);
});

test("spy reveals the value only to its viewer while the target learns only the operated slot",()=>{
  const state=started(3);const target=state.players[1];rigDrawn(state,{drawn:card("spy",9)});
  engine.applyAction(state,"p1",{type:"usePower",targetPlayerId:"p2",slotId:target.slots[0].slotId},{now:3000});
  const p1=engine.buildView(state,"p1"),p2=engine.buildView(state,"p2"),p3=engine.buildView(state,"p3");
  assert.equal(p1.players[1].slots[0].value,target.slots[0].card.value);assert.equal(p1.targetNotice,null);
  assert.equal(p2.players[1].slots[0].value,null);assert.equal(p2.targetNotice.type,"spy");assert.equal(p2.targetNotice.targetSlotId,target.slots[0].slotId);assert.equal("value" in p2.targetNotice,false);
  assert.equal(p3.targetNotice,null);assert.equal(p3.players[1].slots[0].value,null);
  engine.handleTimeout(state,{now:8000});assert.equal(state.phase,"turn");assert.equal(state.currentIndex,1);assert.equal(state.privateReveal,null);
});

test("swap moves card and orientation while only its target learns the operated slot",()=>{
  const state=started(3);const own=state.players[0].slots[0],other=state.players[1].slots[0];own.faceUp=true;other.faceUp=false;const ownId=own.card.id,otherId=other.card.id;state.deck.pop();rigDrawn(state,{drawn:card("swap",11)});
  engine.applyAction(state,"p1",{type:"usePower",ownSlotId:own.slotId,targetPlayerId:"p2",targetSlotId:other.slotId},{now:3000});
  assert.equal(own.card.id,otherId);assert.equal(own.faceUp,false);assert.equal(other.card.id,ownId);assert.equal(other.faceUp,true);
  const p1=engine.buildView(state,"p1"),p2=engine.buildView(state,"p2"),p3=engine.buildView(state,"p3");
  assert.equal(p1.targetNotice,null);assert.equal(p3.targetNotice,null);assert.equal(p2.targetNotice.type,"swap");assert.equal(p2.targetNotice.targetSlotId,other.slotId);assert.equal("value" in p2.targetNotice,false);
  const restored=engine.restoreState(engine.serializeState(state));assert.equal(engine.buildView(restored,"p2").targetNotice.targetSlotId,other.slotId);assert.equal(engine.buildView(restored,"p3").targetNotice,null);
});

test("CABO grants every other player exactly one final turn",()=>{
  const state=started(3);finishInitial(state);engine.applyAction(state,"p1",{type:"callCabo"},{now:8000});
  assert.deepEqual(state.cabo.remainingIds,["p2","p3"]);assert.equal(state.currentIndex,1);
  engine.applyAction(state,"p2",{type:"drawDeck"},{now:8100});engine.applyAction(state,"p2",{type:"discardDrawn"},{now:8200});
  assert.deepEqual(state.cabo.remainingIds,["p3"]);assert.equal(state.currentIndex,2);
  engine.applyAction(state,"p3",{type:"drawDeck"},{now:8300});engine.applyAction(state,"p3",{type:"discardDrawn"},{now:8400});
  assert.equal(state.phase,"roundEnd");assert.equal(state.roundResult.length,3);
});

test("exactly 100 resets to 50 only once",()=>{
  const state=started();const p1=state.players[0];p1.score=99;p1.slots=[{slotId:"x",card:card("x",1),faceUp:false}];state.players[1].slots=[{slotId:"y",card:card("y",2),faceUp:false}];state.phase="turn";state.currentIndex=0;state.deck=[];state.deadline=1;
  engine.handleTimeout(state,{now:1});assert.equal(p1.score,50);assert.equal(p1.resetUsed,true);
});

test("serialized state restores hidden pending data without exposing it",()=>{
  const state=started();finishInitial(state);engine.applyAction(state,"p1",{type:"drawDeck"},{now:8000});const id=state.pending.card.id;
  const restored=engine.restoreState(engine.serializeState(state));assert.equal(restored.pending.card.id,id);assert.equal(engine.buildView(restored,"p2").pendingCard,null);engine.validateState(restored);
});
