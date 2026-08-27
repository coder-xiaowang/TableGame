import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "./server/game-engine.mjs";

const card=(id,color,type,value=null)=>({id,color,type,value});
function readyState(){
  const state=engine.createLobby({capacity:2,host:{id:"p1",name:"甲",connected:true}});
  engine.addPlayer(state,{id:"p2",name:"乙",connected:true});
  engine.applyAction(state,"p1",{type:"start"},{now:1000,random:()=>.314159});
  return state;
}
function rig(state,{hands,deck=[],discard=card("top","red","number",5),currentIndex=0,currentColor="red"}){
  state.phase="playing";state.players.forEach((player,index)=>{player.hand=hands[index];player.unoCalled=false;player.connected=true;});
  state.deck=deck;state.discard=[discard];state.currentColor=currentColor;state.currentIndex=currentIndex;state.direction=1;
  state.pendingDraw=0;state.pendingWild=null;state.pendingWinnerId=null;state.drawnCardId=null;state.unoVulnerableId=null;state.winnerId=null;state.deadline=20000;
}

test("server owns 108 cards and redacts deck plus every opponent hand",()=>{
  const state=readyState();
  const cards=[...state.deck,...state.discard,...state.players.flatMap((player)=>player.hand)];
  assert.equal(cards.length,108);assert.equal(new Set(cards.map((item)=>item.id)).size,108);
  assert.equal(state.discard[0].type,"number");
  const first=engine.buildView(state,"p1");const second=engine.buildView(state,"p2");
  assert.ok(first.players[0].hand.every(Boolean));assert.ok(first.players[1].hand.every((item)=>item===null));
  assert.ok(second.players[0].hand.every((item)=>item===null));
  assert.equal("deck" in first,false);assert.equal("pendingWild" in first,false);assert.equal("pendingWinnerId" in first,false);
});

test("a playable draw grants a fresh deadline and only that card may be played",()=>{
  const state=readyState();
  const old=card("old","red","number",3);const drawn=card("drawn","red","number",9);
  rig(state,{hands:[[old],[card("other","blue","number",1)]],deck:[drawn]});
  engine.applyAction(state,"p1",{type:"draw"},{now:3000,random:()=>0});
  assert.equal(state.drawnCardId,"drawn");assert.equal(state.deadline,18000);
  const view=engine.buildView(state,"p1");assert.deepEqual(view.playableCardIds,["drawn"]);assert.equal(view.permissions.canPass,true);
  assert.throws(()=>engine.applyAction(state,"p1",{type:"play",cardId:"old"},{now:3100}),/不能打出/);
  engine.applyAction(state,"p1",{type:"play",cardId:"drawn"},{now:3200});
  assert.equal(state.discard.at(-1).id,"drawn");assert.equal(state.currentIndex,1);
});

test("+2 and +4 stack, and successful challenge removes only the illegal +4",()=>{
  const state=readyState();
  const draw2=card("d2","red","draw2");const wild4=card("w4",null,"wild4");const illegalColor=card("red7","red","number",7);
  rig(state,{hands:[[draw2,card("p1x","green","number",1)],[wild4,illegalColor]],deck:Array.from({length:12},(_,i)=>card(`deck${i}`,"blue","number",i%10))});
  engine.applyAction(state,"p1",{type:"play",cardId:"d2"},{now:3000});assert.equal(state.pendingDraw,2);assert.equal(state.currentIndex,1);
  engine.applyAction(state,"p2",{type:"play",cardId:"w4",color:"blue"},{now:3100});assert.equal(state.pendingDraw,6);assert.equal(state.currentIndex,0);
  const view=engine.buildView(state,"p1");assert.equal(view.permissions.canChallenge,true);assert.equal(JSON.stringify(view).includes("wasLegal"),false);
  engine.applyAction(state,"p1",{type:"challenge"},{now:3200,random:()=>0});
  assert.equal(state.players[1].hand.length,5);assert.equal(state.pendingDraw,2);assert.equal(state.pendingWild,null);assert.equal(state.currentIndex,0);
});

test("failed +4 challenge draws accumulated penalty plus two and confirms pending winner",()=>{
  const state=readyState();
  const wild4=card("w4",null,"wild4");
  rig(state,{hands:[[wild4],[card("p2x","green","number",2)]],deck:Array.from({length:8},(_,i)=>card(`deck${i}`,"yellow","number",i%10))});
  engine.applyAction(state,"p1",{type:"play",cardId:"w4",color:"blue"},{now:3000});
  assert.equal(state.phase,"playing");assert.equal(state.pendingWinnerId,"p1");
  engine.applyAction(state,"p2",{type:"challenge"},{now:3100,random:()=>0});
  assert.equal(state.players[1].hand.length,7);assert.equal(state.phase,"ended");assert.equal(state.winnerId,"p1");
});

test("accepting a pending +4 confirms a player who went out",()=>{
  const state=readyState();
  rig(state,{hands:[[card("w4",null,"wild4")],[card("p2x","blue","number",2)]],deck:Array.from({length:5},(_,i)=>card(`deck${i}`,"yellow","number",i))});
  engine.applyAction(state,"p1",{type:"play",cardId:"w4",color:"green"},{now:3000});
  engine.applyAction(state,"p2",{type:"acceptPenalty"},{now:3100,random:()=>0});
  assert.equal(state.players[1].hand.length,5);assert.equal(state.phase,"ended");assert.equal(state.winnerId,"p1");
});

test("catch UNO is an atomic out-of-turn action and cannot penalize twice",()=>{
  const state=readyState();
  rig(state,{hands:[[card("red3","red","number",3),card("blue9","blue","number",9)],[card("p2x","yellow","number",2)]],deck:[card("a","green","number",1),card("b","green","number",2)]});
  engine.applyAction(state,"p1",{type:"play",cardId:"red3"},{now:3000});
  assert.equal(state.unoVulnerableId,"p1");
  engine.applyAction(state,"p2",{type:"catchUno"},{now:3050,random:()=>0});
  assert.equal(state.players[0].hand.length,3);assert.equal(state.unoVulnerableId,null);
  assert.throws(()=>engine.applyAction(state,"p2",{type:"catchUno"},{now:3060,random:()=>0}),/没有可抓/);
});

test("calling UNO before a legal penultimate play prevents vulnerability",()=>{
  const state=readyState();
  rig(state,{hands:[[card("red3","red","number",3),card("blue9","blue","number",9)],[card("p2x","yellow","number",2)]]});
  engine.applyAction(state,"p1",{type:"callUno"},{now:2900});
  engine.applyAction(state,"p1",{type:"play",cardId:"red3"},{now:3000});
  assert.equal(state.unoVulnerableId,null);assert.equal(state.players[0].hand.length,1);
});

test("timeouts accept all penalty or draw exactly one without auto-playing",()=>{
  const state=readyState();
  rig(state,{hands:[[card("p1x","blue","number",2)],[card("p2x","yellow","number",2)]],deck:[card("a","red","number",7),card("b","green","number",1),card("c","blue","number",1)]});
  state.pendingDraw=2;const deadline=state.deadline;
  assert.equal(engine.handleTimeout(state,{now:deadline-1,random:()=>0}),false);
  assert.equal(engine.handleTimeout(state,{now:deadline,random:()=>0}),true);
  assert.equal(state.players[0].hand.length,3);assert.equal(state.pendingDraw,0);assert.equal(state.currentIndex,1);
  const nextDeadline=state.deadline;engine.handleTimeout(state,{now:nextDeadline,random:()=>0});
  assert.equal(state.players[1].hand.length,2);assert.equal(state.currentIndex,0);assert.equal(state.drawnCardId,null);
});

test("two-player reverse skips the opponent",()=>{
  const state=readyState();
  rig(state,{hands:[[card("rev","red","reverse"),card("x","blue","number",1)],[card("y","green","number",1)]]});
  engine.applyAction(state,"p1",{type:"play",cardId:"rev"},{now:3000});
  assert.equal(state.direction,-1);assert.equal(state.currentIndex,0);
});

test("live disconnect times out only the current player",()=>{
  const state=readyState();
  rig(state,{hands:[[card("p1x","blue","number",2)],[card("p2x","yellow","number",2)]],deck:[card("a","green","number",1),card("b","green","number",2)]});
  engine.setPresence(state,"p2",false,{now:3000,random:()=>0});
  assert.equal(state.currentIndex,0);assert.equal(state.players[1].hand.length,1);
  engine.setPresence(state,"p1",false,{now:3100,random:()=>0});
  assert.equal(state.players[0].hand.length,2);assert.equal(state.currentIndex,1);
});

test("kicking the active player returns the hidden hand to deck and follows direction",()=>{
  const state=engine.createLobby({capacity:3,host:{id:"p1",name:"甲",connected:true}});
  engine.addPlayer(state,{id:"p2",name:"乙",connected:true});engine.addPlayer(state,{id:"p3",name:"丙",connected:true});
  engine.applyAction(state,"p1",{type:"start"},{now:1000,random:()=>.2});
  state.currentIndex=1;state.direction=-1;
  const returned=state.players[1].hand.length;const deckBefore=state.deck.length;
  engine.removePlayer(state,"p1","p2",{now:3000,random:()=>0});
  assert.equal(state.players.length,2);assert.equal(state.players[state.currentIndex].id,"p1");
  assert.equal(state.deck.length,deckBefore+returned);assert.equal(state.deadline,18000);
});

test("recycling preserves physical cards and keeps the top discard",()=>{
  const state=readyState();
  const old1=card("old1","yellow","number",2),old2=card("old2","blue","number",7),top=card("top2","red","number",5);
  rig(state,{hands:[[card("p1x","green","number",3)],[card("p2x","yellow","number",4)]],deck:[],discard:top});
  state.discard=[old1,old2,top];
  engine.applyAction(state,"p1",{type:"draw"},{now:3000,random:()=>0});
  assert.equal(state.discard.length,1);assert.equal(state.discard[0].id,"top2");
  assert.equal(state.deck.length,1);assert.equal(state.players[0].hand.length,2);
  const ids=[...state.deck,...state.discard,...state.players.flatMap((player)=>player.hand)].map((item)=>item.id);
  assert.equal(new Set(ids).size,ids.length);
});

test("serialized state preserves private draw and challenge data without exposing it",()=>{
  const state=readyState();
  rig(state,{hands:[[card("w4",null,"wild4"),card("x","blue","number",1)],[card("y","green","number",1)]],deck:Array.from({length:5},(_,i)=>card(`deck${i}`,"yellow","number",i))});
  engine.applyAction(state,"p1",{type:"play",cardId:"w4",color:"green"},{now:3000});
  const restored=engine.restoreState(engine.serializeState(state));
  assert.equal(restored.pendingWild.wasLegal,true);
  const view=engine.buildView(restored,"p2");assert.equal(view.permissions.canChallenge,true);assert.equal(JSON.stringify(view).includes("wasLegal"),false);
});
