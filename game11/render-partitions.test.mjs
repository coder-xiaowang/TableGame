import assert from "node:assert/strict";
import test from "node:test";
import { createGame11PartitionRenderer, createGame11RenderModel, notebookEntries } from "./render-partitions.mjs";

const clone=(value)=>structuredClone(value);

test("便笺按传讯队和揭晓编号找提示，最新轮次在前", () => {
  const records = [
    { round: 1, team: "black", code: [4,2,1], clues: ["帆船","潮汐","山峰"] },
    { round: 2, team: "white", code: [2,1,4], clues: ["苹果","稻穗","星辰"] },
    { round: 2, team: "black", code: [3,1,2], decodeGuess: [2,3,1], clues: ["紫色","纸张","海岸"] }
  ];
  assert.deepEqual(notebookEntries(records, "black", 2), [{ round: 2, clue: "海岸" }, { round: 1, clue: "潮汐" }]);
  assert.deepEqual(notebookEntries(records, "white", 3), []);
});
const player=(id,team,seat,overrides={})=>({id,name:id,isHost:id==="p1",connected:true,team,seat,...overrides});
function baseView(){return {
  selfId:"p1",roomRole:"player",phase:"clue",capacity:4,round:2,turnTeam:"white",encryptorId:"p1",
  code:[1,3,2],clues:[],guessStatus:{decode:false,intercept:false},guessDraft:null,deadline:5000,records:[],outcome:null,
  tiebreakStatus:{white:false,black:false},
  players:[player("p1","white",1),player("p2","white",2),player("p3","black",1),player("p4","black",2)],
  teams:{white:{interceptions:0,miscommunications:0,keywords:["钟楼","羽毛","港口","雪"]},black:{interceptions:0,miscommunications:0,keywords:[]}},
  permissions:{canManage:true,canStart:false,canEnd:true,canSit:false,canMove:false,canSubmitClues:true,guessRole:null,canSubmitTiebreak:false}
};}
function harness(){const calls=[];let decisionNode=null,sequence=0;const original=createGame11PartitionRenderer({
  room:()=>calls.push("room"),status:()=>calls.push("status"),lobby:()=>calls.push("lobby"),privateIntel:()=>calls.push("privateIntel"),
  transmission:()=>calls.push("transmission"),decision(){calls.push("decision");decisionNode={id:++sequence};},
  decisionFacts:()=>calls.push("decisionFacts"),scores:()=>calls.push("scores"),history:()=>calls.push("history"),
  result:()=>calls.push("result"),countdown:()=>calls.push("countdown")
});const draw=(view)=>original.render(createGame11RenderModel(view,{memberRole:view.roomRole,roomCode:"CODE"}));return {calls,draw,clear(){calls.length=0;},get decisionNode(){return decisionNode;}};}

test("提示编写期间旁观加入和演出外状态不替换编辑器",()=>{const h=harness(),view=baseView();h.draw(view);const node=h.decisionNode;h.clear();const next=clone(view);next.spectators=[{id:"s1",name:"观察员"}];assert.deepEqual(h.draw(next),[]);assert.strictEqual(h.decisionNode,node);});

test("行动阶段玩家掉线不重建当前私人提示输入",()=>{const h=harness(),view=baseView();h.draw(view);const node=h.decisionNode;h.clear();const next=clone(view);next.players[2].connected=false;assert.deepEqual(h.draw(next),[]);assert.strictEqual(h.decisionNode,node);});

test("猜码状态和服务器草稿只更新事实层而不替换下拉框",()=>{const h=harness(),view=baseView();view.phase="guess";view.code=null;view.clues=["高","轻","远"];view.permissions.canSubmitClues=false;view.permissions.guessRole="decode";h.draw(view);const node=h.decisionNode;h.clear();const saved=clone(view);saved.guessDraft=[1,2,4];assert.deepEqual(h.draw(saved),["decisionFacts"]);assert.strictEqual(h.decisionNode,node);h.clear();const other=clone(saved);other.guessStatus.intercept=true;assert.deepEqual(h.draw(other),["transmission","decisionFacts"]);assert.strictEqual(h.decisionNode,node);});

test("比分、档案和倒计时分别更新自己的分区",()=>{const h=harness(),view=baseView();h.draw(view);const node=h.decisionNode;h.clear();const scored=clone(view);scored.teams.white.interceptions=1;assert.deepEqual(h.draw(scored),["scores"]);assert.strictEqual(h.decisionNode,node);h.clear();const timed=clone(scored);timed.deadline=9000;assert.deepEqual(h.draw(timed),["countdown"]);});

test("进入下一权威阶段才替换编辑器结构",()=>{const h=harness(),view=baseView();h.draw(view);const node=h.decisionNode;h.clear();const next=clone(view);next.phase="guess";next.code=null;next.clues=["高","轻","远"];next.permissions.canSubmitClues=false;next.permissions.guessRole="decode";assert.ok(h.draw(next).includes("decision"));assert.notStrictEqual(h.decisionNode,node);});

test("另一队提交最终裁决不会清空本队四个关键词输入",()=>{const h=harness(),view=baseView();view.phase="tiebreak";view.code=null;view.permissions.canSubmitClues=false;view.permissions.canSubmitTiebreak=true;h.draw(view);const node=h.decisionNode;h.clear();const next=clone(view);next.tiebreakStatus.black=true;assert.deepEqual(h.draw(next),["transmission","decisionFacts"]);assert.strictEqual(h.decisionNode,node);});
