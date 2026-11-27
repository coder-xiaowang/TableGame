import assert from "node:assert/strict";
import test from "node:test";
import {courtDeclarations,createGame16PartitionRenderer,createGame16RenderModel} from "./render-partitions.mjs";

const clone=(value)=>structuredClone(value);
test("行动和阻挡双方都声称船长时，待质疑和待举证跟随公开声明", () => {
  const view = { phase:"challengeAction", action:{type:"steal", actorId:"甲", targetId:"乙", claimedRole:"captain"} };
  const actor = { kind:"action", actorId:"甲", role:"captain" };
  const blocker = { kind:"block", actorId:"乙", role:"captain" };
  assert.deepEqual(courtDeclarations(view), [{...actor, stamp:"可质疑"}]);
  view.phase = "proveClaim";
  view.challenge = {context:"action", claimantId:"甲"};
  assert.deepEqual(courtDeclarations(view), [{...actor, stamp:"待举证"}]);
  view.phase = "block";
  view.challenge = null;
  assert.deepEqual(courtDeclarations(view), [actor]);
  Object.assign(view.action, {blockerId:"乙", blockRole:"captain"});
  view.phase = "challengeBlock";
  assert.deepEqual(courtDeclarations(view), [actor, {...blocker, stamp:"可质疑"}]);
  view.phase = "proveClaim";
  view.challenge = {context:"block", claimantId:"乙"};
  assert.deepEqual(courtDeclarations(view), [actor, {...blocker, stamp:"待举证"}]);
  view.phase = "loseInfluence";
  view.challenge = null;
  assert.deepEqual(courtDeclarations(view), [actor, blocker]);
  assert.deepEqual(courtDeclarations({phase:"action",action:null}), []);
});
const player=(id,overrides={})=>({id,name:id,isHost:id==="p1",connected:true,coins:2,eliminated:false,influences:[{id:`${id}-1`,role:id==="p1"?"duke":null,revealed:false},{id:`${id}-2`,role:id==="p1"?"captain":null,revealed:false}],...overrides});
function baseView(){return{selfId:"p1",roomRole:"player",phase:"challengeAction",capacity:3,currentPlayerId:"p2",deckCount:9,deadline:5000,winnerId:null,
  action:{type:"tax",actorId:"p2",targetId:null},reaction:{id:"r1",kind:"challengeAction",eligibleIds:["p1","p3"],passedIds:[]},challenge:null,loss:null,exchange:null,proofOptions:[],moments:[],logs:[],players:[player("p1"),player("p2"),player("p3")],
  permissions:{canManage:true,canKick:true,canSetCapacity:false,canStart:false,canEnd:true,canRestart:false,canDeclareAction:false,canRespond:true,canChallenge:true,canBlock:false,canProve:false,canLoseInfluence:false,canExchange:false}};}
function harness(){const calls=[],nodes={players:null,decision:null,private:null};let sequence=0;const renderer=createGame16PartitionRenderer(Object.fromEntries(
  ["room","status","deck","players","private","decision","log","countdown"].map((name)=>[name,()=>{calls.push(name);if(name in nodes)nodes[name]={id:++sequence};}])));
  return{calls,nodes,draw(view,options={}){return renderer.render(createGame16RenderModel(view,{memberRole:view.roomRole,roomCode:"COUP",...options}));},clear(){calls.length=0;}};}

test("演出事件与旁观者变化不替换当前响应窗口",()=>{const h=harness(),view=baseView();h.draw(view);const saved={...h.nodes};h.clear();const next=clone(view);next.moments=[{id:1}];next.spectators=[{id:"s1"}];assert.deepEqual(h.draw(next),[]);assert.deepEqual(h.nodes,saved);});
test("其他玩家掉线只更新玩家席而不替换质疑按钮",()=>{const h=harness(),view=baseView();h.draw(view);const decision=h.nodes.decision;h.clear();const next=clone(view);next.players[2].connected=false;assert.deepEqual(h.draw(next),["players"]);assert.strictEqual(h.nodes.decision,decision);});
test("日志和倒计时独立于响应窗口",()=>{const h=harness(),view=baseView();h.draw(view);const decision=h.nodes.decision;h.clear();const next=clone(view);next.logs.push({text:"记录"});assert.deepEqual(h.draw(next),["log"]);h.clear();next.deadline=9000;assert.deepEqual(h.draw(next),["countdown"]);assert.strictEqual(h.nodes.decision,decision);});
test("新的reactionId才替换质疑响应区",()=>{const h=harness(),view=baseView();h.draw(view);const decision=h.nodes.decision;h.clear();const next=clone(view);next.reaction.id="r2";assert.deepEqual(h.draw(next),["decision"]);assert.notStrictEqual(h.nodes.decision,decision);});
test("同一响应窗口中其他玩家放弃不会替换我的质疑按钮",()=>{const h=harness(),view=baseView();h.draw(view);const decision=h.nodes.decision;h.clear();const next=clone(view);next.reaction.passedIds.push("p3");assert.deepEqual(h.draw(next),[]);assert.strictEqual(h.nodes.decision,decision);});
test("本地目标行动只更新决策分区",()=>{const h=harness(),view=baseView();view.phase="action";view.currentPlayerId="p1";view.action=null;view.reaction=null;view.permissions.canRespond=false;view.permissions.canChallenge=false;view.permissions.canDeclareAction=true;h.draw(view);h.clear();assert.deepEqual(h.draw(view,{selectedAction:"steal"}),["decision"]);});
test("大使本地选牌只更新决策分区",()=>{const h=harness(),view=baseView();view.phase="exchange";view.reaction=null;view.action={type:"exchange",actorId:"p1"};view.exchange={playerId:"p1",keepCount:2,originalIds:["a","b"],cards:[{id:"a",role:"duke"},{id:"b",role:"captain"},{id:"c",role:"assassin"},{id:"d",role:"contessa"}]};view.permissions.canRespond=false;view.permissions.canChallenge=false;view.permissions.canExchange=true;h.draw(view,{exchangeSelection:["a","b"]});h.clear();assert.deepEqual(h.draw(view,{exchangeSelection:["a","c"]}),["decision"]);});
