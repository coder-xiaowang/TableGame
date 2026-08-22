"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createCountdown, createHostTimer, createRoomClient,
  createSessionStore, escapeHtml, renderConnectionStatus, renderCountdown, setHidden,
  setModeVisibility, shuffle
} from "/shared/client/index.js";
import {
  createCodeDeck, isValidCode, lastEligiblePlayer, lockGuessDrafts, normalizeClue, otherTeam, outcomeForTeams,
  scoreTransmission, validateClues
} from "./rules.js";
import { KEYWORDS } from "./words.js";

const PROTOCOL_VERSION = 3;
const CLUE_SECONDS = 150;
const GUESS_SECONDS = 100;
const REVEAL_SECONDS = 8;
const $ = (id) => document.getElementById(id);
const ids = ["connectionStatus","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","roomCodeDisplay","phaseBadge","roundText","timerWrap","timerText","timerBar","hostTools","startGameButton","endGameButton","notice","lobbyArea","gameArea","myTeamBadge","keywordRack","secretCode","operationTitle","encryptorName","clueComposer","clue1","clue2","clue3","submitCluesButton","clueDisplay","guessComposer","guessRoleText","guess1","guess2","guess3","submitGuessButton","waitingText","whiteScore","blackScore","historyList","resultPanel","winnerText","finalKeywords","finalRecords"];
const E = Object.fromEntries(ids.map((id) => [id, $(id)]));
const TEAM_NAME = { white: "白队", black: "黑队" };

let mode = "host";
let state = null;
let guestView = null;
let guessEditorKey = "";
const sessions = createSessionStore({ gameId: "decrypto" });
const hostTimer = createHostTimer();
const countdown = createCountdown({ onTick(value) { renderCountdown({ textElement:E.timerText, barElement:E.timerBar }, value); } });

const room = createRoomClient({
  protocolVersion: PROTOCOL_VERSION,
  sessionStore: sessions,
  onStatus(status) { renderConnectionStatus(E.connectionStatus, status, room.snapshot().roomCode); },
  handlers: {
    onHello: admitPlayer,
    onPresence: updatePresence,
    onAction: applyAction,
    onView(view) { guestView = view; enterRoom(); render(); },
    onRejected(message) { alert(message || "房主拒绝了加入请求。"); location.reload(); },
    onKicked() { alert("你已被移出房间。"); location.reload(); }
  }
});

function player(id, name, isHost = false) { return { id, name, isHost, connected:true, team:null, seat:0, usedClues:[] }; }
function teamState() { return { keywords:[], interceptions:0, miscommunications:0, codeDeck:[], encryptorCursor:0 }; }
function makeLobby(capacity, host) {
  return { phase:"lobby", capacity, players:[host], teams:{white:teamState(),black:teamState()}, round:0, turnTeam:"white", encryptorId:"", code:null, clues:[], guesses:{decode:null,intercept:null}, guessDrafts:{decode:null,intercept:null}, deadline:0, records:[], outcome:null, tiebreakGuesses:{white:null,black:null} };
}
function currentView() { return mode === "host" ? (state ? buildView(room.snapshot().playerId) : null) : guestView; }
function sortedTeam(players, team) { return players.filter((p) => p.team === team).sort((a,b) => a.seat-b.seat); }
function submitterFor(players, team, encryptorId = "") { return lastEligiblePlayer(sortedTeam(players, team), team, encryptorId); }
function enterRoom() { setHidden(E.setupPanel,true); setHidden(E.roomPanel,false); setHidden(E.hostTools,mode !== "host"); E.roomCodeDisplay.textContent=room.snapshot().roomCode; }
function sync() { render(); broadcast(); }
function broadcast() { if (mode!=="host"||!state) return; for (const p of state.players) if (!p.isHost) room.sendView(p.id,buildView(p.id)).catch(()=>{}); }
function submit(action) { Promise.resolve(room.submitAction(action)).catch((error)=>{ E.connectionStatus.textContent=`操作发送失败：${error.message}`; }); }

async function createGameRoom() {
  E.createRoomButton.disabled=true;
  try { const name=cleanPlayerName(E.hostNameInput.value,"房主"); const result=await room.createRoom({name}); state=makeLobby(Number(E.playerCountSelect.value),player(result.playerId,name,true)); enterRoom(); render(); }
  catch(error){ alert(`创建失败：${error.message}\n请确认已运行 node game11/signal-server.js`); }
  finally { E.createRoomButton.disabled=false; }
}
async function joinGameRoom() {
  E.joinRoomButton.disabled=true;
  try { await room.joinRoom({code:E.roomCodeInput.value,name:E.guestNameInput.value}); E.connectionStatus.textContent="已连接，等待房主同步"; }
  catch(error){ alert(`加入失败：${error.message}`); }
  finally { E.joinRoomButton.disabled=false; }
}
function admitPlayer(id,payload) {
  if (!state||mode!=="host") return;
  const old=state.players.find((p)=>p.id===id);
  if(old){old.connected=true;return sync();}
  if(state.phase!=="lobby") return room.reject(id,"行动已经开始，不能中途加入。");
  if(state.players.length>=state.capacity) return room.reject(id,"房间人数已满。");
  state.players.push(player(id,cleanPlayerName(payload.name,"译码员"))); sync();
}
function updatePresence(id,connected){const p=state?.players.find((p)=>p.id===id);if(p){p.connected=connected;sync();}}

function applyAction(id,action) {
  if (!state||!action) return;
  if(action.type==="sit") return sitPlayer(id,action.team);
  if(action.type==="move") return movePlayer(id,Number(action.direction));
  if(action.type==="clues") return receiveClues(id,action.clues);
  if(action.type==="guessDraft") return receiveGuessDraft(id,action.code);
  if(action.type==="guess") return receiveGuess(id,action.code);
  if(action.type==="tiebreak") return receiveTiebreak(id,action.words);
}
function sitPlayer(id,team) {
  if(state.phase!=="lobby"||!["white","black",null].includes(team)) return;
  const p=state.players.find((p)=>p.id===id); if(!p)return;
  p.team=team; p.seat=team ? Math.max(0,...sortedTeam(state.players,team).filter((x)=>x.id!==id).map((x)=>x.seat))+1 : 0; normalizeSeats(team); sync();
}
function movePlayer(id,direction) {
  if(state.phase!=="lobby"||![-1,1].includes(direction)) return;
  const p=state.players.find((p)=>p.id===id); if(!p?.team)return;
  const list=sortedTeam(state.players,p.team), index=list.findIndex((x)=>x.id===id), target=list[index+direction]; if(!target)return;
  [p.seat,target.seat]=[target.seat,p.seat]; sync();
}
function normalizeSeats(team){if(!team)return;sortedTeam(state.players,team).forEach((p,i)=>p.seat=i+1);}

function canStart() {
  const white=sortedTeam(state.players,"white"),black=sortedTeam(state.players,"black");
  return state.players.length===state.capacity && !state.players.some((p)=>!p.connected||!p.team) && white.length>=2 && black.length>=2;
}
function startGame() {
  if(!canStart()) return alert("需要所有玩家在线入座，且每队至少有 2 人。");
  const words=shuffle([...KEYWORDS]);
  state.teams.white={...teamState(),keywords:words.splice(0,4),codeDeck:shuffle(createCodeDeck())};
  state.teams.black={...teamState(),keywords:words.splice(0,4),codeDeck:shuffle(createCodeDeck())};
  state.players.forEach((p)=>p.usedClues=[]); state.round=1; state.records=[]; state.outcome=null; beginTransmission("white");
}
function endGameEarly(){if(confirm("确定结束行动并返回大厅吗？")){hostTimer.clear();const capacity=state.capacity,players=state.players;state=makeLobby(capacity,players[0]);state.players=players.map((p)=>({...p,usedClues:[]}));sync();}}
function drawCode(team){let deck=state.teams[team].codeDeck;if(!deck.length)deck=state.teams[team].codeDeck=shuffle(createCodeDeck());return deck.pop();}
function beginTransmission(team) {
  hostTimer.clear(); state.turnTeam=team; state.phase="clue"; state.clues=[];state.guesses={decode:null,intercept:null};state.guessDrafts={decode:null,intercept:null};state.code=drawCode(team);
  const members=sortedTeam(state.players,team), ts=state.teams[team]; state.encryptorId=members[ts.encryptorCursor%members.length].id;ts.encryptorCursor+=1;
  state.deadline=hostTimer.schedule(CLUE_SECONDS,()=>receiveClues(state.encryptorId,["提示超时一","提示超时二","提示超时三"],true));sync();
}
function receiveClues(id,clues,timeout=false) {
  if(state.phase!=="clue"||id!==state.encryptorId)return;
  const p=state.players.find((p)=>p.id===id), error=timeout?"":validateClues(clues,state.teams[p.team].keywords,p.usedClues);
  if(error)return;
  hostTimer.clear();state.clues=clues.map((x)=>String(x).trim());if(!timeout)p.usedClues.push(...state.clues);state.phase="guess";
  state.deadline=hostTimer.schedule(GUESS_SECONDS,resolveTransmission);sync();
}
function receiveGuess(id,code) {
  if(state.phase!=="guess")return;
  const active=state.turnTeam,opponent=otherTeam(active),decodeBy=submitterFor(state.players,active,state.encryptorId),interceptBy=submitterFor(state.players,opponent);
  const numbers=Array.isArray(code)?code.map(Number):[];if(numbers.length!==3||new Set(numbers).size!==3||numbers.some((n)=>n<1||n>4))return;
  if(id===decodeBy?.id&&!state.guesses.decode)state.guesses.decode=numbers;
  else if(state.round>1&&id===interceptBy?.id&&!state.guesses.intercept)state.guesses.intercept=numbers;else return;
  if(state.guesses.decode&&(state.round===1||state.guesses.intercept))resolveTransmission();else sync();
}
function guessRoleFor(id) {
  if(state.phase!=="guess")return null;
  const active=state.turnTeam,decodeBy=submitterFor(state.players,active,state.encryptorId),interceptBy=submitterFor(state.players,otherTeam(active));
  if(id===decodeBy?.id)return "decode";
  if(state.round>1&&id===interceptBy?.id)return "intercept";
  return null;
}
function receiveGuessDraft(id,code) {
  const role=guessRoleFor(id),numbers=Array.isArray(code)?code.map(Number):[];
  if(!role||state.guesses[role]||!isValidCode(numbers))return;
  state.guessDrafts[role]=numbers;sync();
}
function resolveTransmission() {
  if(state.phase!=="guess")return;hostTimer.clear();
  state.guesses=lockGuessDrafts(state.guesses,state.guessDrafts);
  const team=state.turnTeam,opponent=otherTeam(team),result=scoreTransmission({code:state.code,decodeGuess:state.guesses.decode,interceptGuess:state.guesses.intercept,allowIntercept:state.round>1});
  if(result.intercepted)state.teams[opponent].interceptions+=1;if(result.miscommunicated)state.teams[team].miscommunications+=1;
  state.records.push({round:state.round,team,encryptorId:state.encryptorId,clues:[...state.clues],code:[...state.code],decodeGuess:state.guesses.decode,interceptGuess:state.guesses.intercept,...result});
  state.phase="reveal";state.deadline=hostTimer.schedule(REVEAL_SECONDS,advanceAfterReveal);sync();
}
function advanceAfterReveal() {
  if(state.phase!=="reveal")return;
  if(state.turnTeam==="white")return beginTransmission("black");
  const outcome=outcomeForTeams(state.teams,state.round);
  if(outcome?.needsKeywordGuess)return beginTiebreak();
  if(outcome)return finishGame(outcome.winners);
  state.round+=1;beginTransmission("white");
}
function beginTiebreak(){hostTimer.clear();state.phase="tiebreak";state.tiebreakGuesses={white:null,black:null};state.deadline=hostTimer.schedule(GUESS_SECONDS,resolveTiebreak);sync();}
function receiveTiebreak(id,words){if(state.phase!=="tiebreak")return;const p=state.players.find((p)=>p.id===id),submitter=submitterFor(state.players,p?.team);if(!p?.team||submitter?.id!==id||state.tiebreakGuesses[p.team])return;state.tiebreakGuesses[p.team]=(words||[]).map((x)=>String(x).trim()).slice(0,4);if(state.tiebreakGuesses.white&&state.tiebreakGuesses.black)resolveTiebreak();else sync();}
function resolveTiebreak(){if(state.phase!=="tiebreak")return;hostTimer.clear();const scores={};for(const team of ["white","black"]){const target=state.teams[otherTeam(team)].keywords,guess=state.tiebreakGuesses[team]||[];scores[team]=target.filter((word,i)=>normalizeClue(word)===normalizeClue(guess[i])).length;}const best=Math.max(scores.white,scores.black);finishGame(scores.white===scores.black?["white","black"]:[scores.white===best?"white":"black"],scores);}
function finishGame(winners,tiebreakScores=null){hostTimer.clear();state.phase="ended";state.deadline=0;state.outcome={winners,tiebreakScores};sync();}

function buildView(viewerId) {
  const me=state.players.find((p)=>p.id===viewerId),ended=state.phase==="ended",reveal=state.phase==="reveal";
  const teams={};for(const team of ["white","black"])teams[team]={interceptions:state.teams[team].interceptions,miscommunications:state.teams[team].miscommunications,keywords:(ended||me?.team===team)?[...state.teams[team].keywords]:[]};
  const guessRole=guessRoleFor(viewerId),guessDraft=guessRole&&state.guessDrafts[guessRole]?[...state.guessDrafts[guessRole]]:null;
  return {selfId:viewerId,phase:state.phase,capacity:state.capacity,players:state.players.map(({usedClues,...p})=>({...p,usedClues:p.id===viewerId?[...usedClues]:[]})),teams,round:state.round,turnTeam:state.turnTeam,encryptorId:state.encryptorId,code:(viewerId===state.encryptorId&&state.phase==="clue")||reveal?[...state.code]:null,clues:[...state.clues],guessStatus:{decode:Boolean(state.guesses.decode),intercept:Boolean(state.guesses.intercept)},guessDraft,deadline:state.deadline,records:state.records.map((r)=>({...r,clues:[...r.clues],code:[...r.code]})),outcome:state.outcome,tiebreakStatus:{white:Boolean(state.tiebreakGuesses.white),black:Boolean(state.tiebreakGuesses.black)}};
}

function renderLobby(view) {
  const me=view.players.find((p)=>p.id===view.selfId);E.lobbyArea.innerHTML=["white","black"].map((team)=>{const list=sortedTeam(view.players,team);return `<div class="panel team-column ${team}"><div class="team-head"><h2>${TEAM_NAME[team]}</h2><button data-sit="${team}" ${view.phase!=="lobby"?"disabled":""}>${me.team===team?"已入队":"加入此队"}</button></div>${list.length?list.map((p,i)=>`<div class="seat"><i class="${p.connected?"online":"offline"}"></i><span><b>${i+1}. ${escapeHtml(p.name)}</b>${p.isHost?"（房主）":""}</span><span class="seat-actions">${p.id===view.selfId&&view.phase==="lobby"?`<button data-move="-1">上移</button><button data-move="1">下移</button>`:""}</span></div>`).join(""):"<p>等待人员入座</p>"}</div>`}).join("")+`<div class="panel bench"><b>未入队</b><div class="bench-list">${view.players.filter((p)=>!p.team).map((p)=>`<span class="player-chip">${escapeHtml(p.name)}${p.id===view.selfId?` <button data-sit="white">入座</button>`:""}</span>`).join("")||"暂无"}</div></div>`;
  E.lobbyArea.querySelectorAll("[data-sit]").forEach((b)=>b.onclick=()=>submit({type:"sit",team:b.dataset.sit}));E.lobbyArea.querySelectorAll("[data-move]").forEach((b)=>b.onclick=()=>submit({type:"move",direction:Number(b.dataset.move)}));
}
function scoreHtml(view,team){const t=view.teams[team];return `<div class="score-team"><h3>${TEAM_NAME[team]}</h3><div class="score-tokens">截获 ${t.interceptions} / 2，误传 ${t.miscommunications} / 2</div></div>`;}
function codeText(code){return code?.length?code.join(" - "):"未提交";}
function renderGame(view) {
  const me=view.players.find((p)=>p.id===view.selfId),active=TEAM_NAME[view.turnTeam],encryptor=view.players.find((p)=>p.id===view.encryptorId),own=view.teams[me.team];
  E.myTeamBadge.textContent=TEAM_NAME[me.team]||"观察员";E.myTeamBadge.className=`team-badge ${me.team||""}`;E.keywordRack.innerHTML=own?.keywords.map((word,i)=>`<div class="keyword"><b>${i+1}</b><span>${escapeHtml(word)}</span></div>`).join("")||"<p>你没有队伍关键词。</p>";
  setHidden(E.secretCode,!view.code);E.secretCode.textContent=view.code?`本轮密码：${codeText(view.code)}`:"";E.operationTitle.textContent=`${active}传讯`;E.encryptorName.textContent=encryptor?`传讯者：${encryptor.name}`:"";
  setHidden(E.clueComposer,!(view.phase==="clue"&&view.selfId===view.encryptorId));E.clueDisplay.innerHTML=view.clues.map((clue,i)=>`<div class="clue-card"><b>${i+1}</b><span>${escapeHtml(clue)}</span></div>`).join("");
  const decodeBy=submitterFor(view.players,view.turnTeam,view.encryptorId),interceptBy=submitterFor(view.players,otherTeam(view.turnTeam));let canGuess=false,role="";
  if(view.phase==="guess"&&view.selfId===decodeBy?.id&&!view.guessStatus.decode){canGuess=true;role=`你是${active}最后一位非传讯者，请提交己方破译。`;}
  if(view.phase==="guess"&&view.round>1&&view.selfId===interceptBy?.id&&!view.guessStatus.intercept){canGuess=true;role=`你是${TEAM_NAME[otherTeam(view.turnTeam)]}最后一位玩家，请提交拦截猜测。`;}
  const editorKey=`${view.round}:${view.turnTeam}:${view.selfId}`;if(canGuess&&guessEditorKey!==editorKey){[E.guess1.value,E.guess2.value,E.guess3.value]=["1","2","3"];guessEditorKey=editorKey;}setHidden(E.guessComposer,!canGuess);if(canGuess&&view.guessDraft){[E.guess1.value,E.guess2.value,E.guess3.value]=view.guessDraft.map(String);}E.guessRoleText.textContent=canGuess?`${role}${view.guessDraft?" 当前选择已保存，超时将自动锁定。":" 修改选择后会自动保存；若不修改，请点击按钮确认当前选择。"}`:role;
  if(view.phase==="tiebreak"){const last=submitterFor(view.players,me.team);const can=last?.id===view.selfId&&!view.tiebreakStatus[me.team];setHidden(E.guessComposer,!can);E.guessRoleText.textContent="最终裁决：依次输入你认为对应 1 到 4 号位置的关键词。";if(can){document.querySelector(".code-inputs").innerHTML=[1,2,3,4].map((n)=>`<input class="tie-word" maxlength="30" placeholder="${n} 号关键词">`).join("");E.submitGuessButton.textContent="提交关键词猜测";}}
  E.waitingText.textContent=statusText(view,decodeBy,interceptBy);E.whiteScore.innerHTML=scoreHtml(view,"white");E.blackScore.innerHTML=scoreHtml(view,"black");renderHistory(view);
}
function statusText(view,decodeBy,interceptBy){if(view.phase==="clue")return view.selfId===view.encryptorId?"请按密码顺序写出三条全新提示。":"传讯者正在编写三条提示，请稍候。";if(view.phase==="guess")return `己方破译：${view.guessStatus.decode?"已锁定":"等待 "+(decodeBy?.name||"")}；拦截：${view.round===1?"首轮跳过":view.guessStatus.intercept?"已锁定":"等待 "+(interceptBy?.name||"")}`;if(view.phase==="reveal"){const r=view.records.at(-1);return `密码 ${codeText(r.code)}；${r.intercepted?"对方截获成功":"未被截获"}；${r.miscommunicated?"己方发生误传":"己方破译成功"}`;}if(view.phase==="tiebreak")return "净胜分相同：双方正在猜测对方四个关键词。";return "";}
function renderHistory(view){E.historyList.innerHTML=[...view.records].reverse().map((r)=>`<article class="record ${r.team}"><div class="record-head"><span>第 ${r.round} 轮，${TEAM_NAME[r.team]}传讯</span><span>${codeText(r.code)}</span></div><div class="record-clues">${r.clues.map((c,i)=>`<span>${i+1}. ${escapeHtml(c)}，对应 ${r.code[i]}</span>`).join("")}</div><div class="record-result">己方猜测 ${codeText(r.decodeGuess)}：${r.miscommunicated?"误传":"正确"}；对方猜测 ${r.round===1?"首轮不拦截":codeText(r.interceptGuess)+(r.intercepted?"，截获成功":"，截获失败")}</div></article>`).join("")||"<p>提示公开后，推理档案会记录在这里。</p>";}
function renderResult(view){const names=view.outcome.winners.map((t)=>TEAM_NAME[t]);E.winnerText.textContent=names.length===2?"最终裁决仍然平手，双方共同获胜":`${names[0]}完成截码任务`;E.finalKeywords.innerHTML=["white","black"].map((t)=>`<div><b>${TEAM_NAME[t]}</b><p>${view.teams[t].keywords.map((w,i)=>`${i+1}. ${escapeHtml(w)}`).join("，")}</p></div>`).join("");E.finalRecords.innerHTML=`共完成 ${view.records.length} 次传讯，全部密码与提示已在上方档案公开。`;}
function render() {
  const view=currentView();if(!view)return;const lobby=view.phase==="lobby",ended=view.phase==="ended";E.roomCodeDisplay.textContent=room.snapshot().roomCode;E.phaseBadge.textContent={lobby:"等待部署",clue:"编写提示",guess:"猜码中",reveal:"密码公开",tiebreak:"最终裁决",ended:"行动结束"}[view.phase];E.roundText.textContent=`第 ${view.round} / 8 轮`;setHidden(E.lobbyArea,!lobby);setHidden(E.gameArea,lobby||ended);setHidden(E.resultPanel,!ended);setHidden(E.startGameButton,!lobby);E.startGameButton.disabled=mode!=="host"||!canStartView(view);setHidden(E.endGameButton,mode!=="host"||lobby);E.notice.textContent=lobby?`当前 ${view.players.length} / ${view.capacity} 人；所有人入座且每队至少 2 人后开始。`:noticeText(view);renderLobby(view);if(!lobby)renderGame(view);if(ended)renderResult(view);if(view.deadline){countdown.start(view.deadline,(view.phase==="clue"?CLUE_SECONDS:view.phase==="reveal"?REVEAL_SECONDS:GUESS_SECONDS)*1000);setHidden(E.timerWrap,false);}else{countdown.stop();setHidden(E.timerWrap,true);}
}
function canStartView(view){const w=sortedTeam(view.players,"white"),b=sortedTeam(view.players,"black");return view.players.length===view.capacity&&!view.players.some((p)=>!p.connected||!p.team)&&w.length>=2&&b.length>=2;}
function noticeText(view){const e=view.players.find((p)=>p.id===view.encryptorId);return view.phase==="ended"?"行动结束，双方机密现已公开。":`第 ${view.round} 轮，${TEAM_NAME[view.turnTeam]}传讯${e?`，当前传讯者：${e.name}`:""}`;}

function populateCodeSelects(){for(const select of [E.guess1,E.guess2,E.guess3])select.innerHTML=[1,2,3,4].map((n)=>`<option value="${n}">${n}</option>`).join("");E.guess2.value="2";E.guess3.value="3";}
E.hostModeButton.onclick=()=>{mode="host";setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});};E.guestModeButton.onclick=()=>{mode="guest";setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});};E.createRoomButton.onclick=createGameRoom;E.joinRoomButton.onclick=joinGameRoom;E.startGameButton.onclick=startGame;E.endGameButton.onclick=endGameEarly;E.submitCluesButton.onclick=()=>{const view=currentView(),me=view.players.find((p)=>p.id===view.selfId),clues=[E.clue1.value,E.clue2.value,E.clue3.value],error=validateClues(clues,view.teams[me.team].keywords,me.usedClues);if(error)return alert(error);submit({type:"clues",clues});};E.submitGuessButton.onclick=()=>{const view=currentView();if(view.phase==="tiebreak")submit({type:"tiebreak",words:[...document.querySelectorAll(".tie-word")].map((x)=>x.value)});else{const code=[E.guess1.value,E.guess2.value,E.guess3.value].map(Number);if(new Set(code).size!==3)return alert("三位密码不能包含重复数字。");submit({type:"guess",code});}};bindRoomCodeInput(E.roomCodeInput);populateCodeSelects();setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});room.checkServer().catch(()=>{});
[E.guess1,E.guess2,E.guess3].forEach((select)=>select.addEventListener("change",()=>{const view=currentView();if(view?.phase!=="guess")return;const code=[E.guess1.value,E.guess2.value,E.guess3.value].map(Number);if(!isValidCode(code)){E.guessRoleText.textContent="当前组合包含重复数字，尚未保存；超时仍会采用上一次合法选择。";return;}submit({type:"guessDraft",code});}));
