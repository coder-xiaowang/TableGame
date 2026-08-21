"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createCountdown, createHostTimer, createRoomClient,
  createSessionStore, escapeHtml, renderConnectionStatus, renderCountdown, setHidden,
  setModeVisibility, shuffle
} from "/shared/client/index.js";
import { duplicateGroups, normalizeText, requiredClueSlots, scoreLabel, strictMajority, validateClue } from "./rules.js";
import { WORDS } from "./words.js";

const PROTOCOL_VERSION = 2;
const ACTION_SECONDS = 60;
const REVEAL_SECONDS = 8;
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries([
  "connectionStatus","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup",
  "hostNameInput","guestNameInput","playerCountSelect","gameModeSelect","createRoomButton","joinRoomButton",
  "roomCodeInput","roomCodeDisplay","hostTools","startGameButton","endGameButton","phaseBadge","roundText",
  "timerWrap","timerText","timerBar","notice","lobbyArea","gameArea","scoreDisplay","statsDisplay","playerList",
  "stageTitle","roleBadge","secretWord","choiceArea","clueArea","clueInputs","submitCluesButton","reviewArea",
  "reviewClues","finishReviewButton","guessArea","visibleClues","guessInput","submitGuessButton","passButton",
  "voteArea","voteQuestion","voteYesButton","voteNoButton","voteStatus","revealArea","waitingText","historyList",
  "resultPanel","resultTitle","resultStats"
].map((id) => [id, $(id)]));

let mode = "host";
let state = null;
let guestView = null;
let reviewSelection = new Set();
const sessions = createSessionStore({ gameId: "just-one" });
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
    onKicked() { alert("你已被房主移出房间。"); location.reload(); }
  }
});

function makePlayer(id, name, isHost = false) { return { id, name, isHost, connected:true }; }
function makeLobby(capacity, gameMode, host) {
  return { phase:"lobby", capacity, gameMode, players:[host], guesserIndex:0, round:0, deck:[], choices:[], wordIndex:null,
    secretWord:"", clues:[], reviewerId:"", guess:"", votes:{}, outcome:null, correct:0, wrong:0, passed:0,
    deadline:0, history:[] };
}
function currentPlayer() { return state?.players[state.guesserIndex] || null; }
function currentView() { return mode === "host" ? (state ? buildView(room.snapshot().playerId) : null) : guestView; }
function enterRoom() { setHidden(E.setupPanel,true); setHidden(E.roomPanel,false); setHidden(E.hostTools,mode!=="host"); E.roomCodeDisplay.textContent=room.snapshot().roomCode; }
function sync() { render(); broadcast(); }
function broadcast() { if(mode!=="host"||!state)return; for(const p of state.players) if(!p.isHost) room.sendView(p.id,buildView(p.id)).catch(()=>{}); }
function submit(action) { Promise.resolve(room.submitAction(action)).catch((error)=>{E.connectionStatus.textContent=`操作发送失败：${error.message}`;}); }

async function createGameRoom() {
  E.createRoomButton.disabled=true;
  try { const name=cleanPlayerName(E.hostNameInput.value,"房主"), result=await room.createRoom({name}); state=makeLobby(Number(E.playerCountSelect.value),E.gameModeSelect.value,makePlayer(result.playerId,name,true)); enterRoom(); render(); }
  catch(error){alert(`创建失败：${error.message}\n请确认已运行 node game12/signal-server.js`);} finally{E.createRoomButton.disabled=false;}
}
async function joinGameRoom() {
  E.joinRoomButton.disabled=true;
  try { await room.joinRoom({code:E.roomCodeInput.value,name:E.guestNameInput.value}); E.connectionStatus.textContent="已连接，等待房主同步"; }
  catch(error){alert(`加入失败：${error.message}`);} finally{E.joinRoomButton.disabled=false;}
}
function admitPlayer(id,payload) {
  if(!state||mode!=="host")return; const old=state.players.find((p)=>p.id===id);
  if(old){old.connected=true;return sync();}
  if(state.phase!=="lobby")return room.reject(id,"游戏已经开始，不能中途加入。");
  if(state.players.length>=state.capacity)return room.reject(id,"房间人数已满。");
  state.players.push(makePlayer(id,cleanPlayerName(payload.name,"玩家")));sync();
}
function updatePresence(id,connected){const p=state?.players.find((p)=>p.id===id);if(p&&p.connected!==connected){p.connected=connected;sync();}}
async function kickPlayer(id){if(state.phase!=="lobby")return;const p=state.players.find((x)=>x.id===id);if(!p||p.isHost||!confirm(`确定移出 ${p.name} 吗？`))return;await room.kick(id);state.players=state.players.filter((x)=>x.id!==id);sync();}

function makeCards(count) {
  let pool=shuffle([...WORDS]), cards=[];
  while(cards.length<count){if(pool.length<5)pool=shuffle([...WORDS]);cards.push(pool.splice(0,5));}
  return cards;
}
function startGame(){
  if(state.phase!=="lobby")return;
  if(state.players.length!==state.capacity)return alert(`需要 ${state.capacity} 位玩家到齐。`);
  if(state.players.some((p)=>!p.connected))return alert("请等待所有玩家恢复连接。");
  Object.assign(state,{phase:"choose",guesserIndex:Math.floor(Math.random()*state.players.length),round:0,deck:state.gameMode==="classic"?makeCards(13):[],correct:0,wrong:0,passed:0,history:[]});
  beginRound();
}
function resetLobby(){hostTimer.clear();const {capacity,gameMode,players}=state;state=makeLobby(capacity,gameMode,players.find((p)=>p.isHost));state.players=players;sync();}
function finishGame(){hostTimer.clear();state.phase="ended";state.deadline=0;sync();}
function endOrReset(){if(state.phase==="ended")return resetLobby();if(confirm("确定结束当前游戏吗？"))finishGame();}

function beginRound(){
  hostTimer.clear();
  if(state.gameMode==="classic"&&!state.deck.length)return finishGame();
  state.round+=1;state.phase="choose";state.choices=state.gameMode==="classic"?state.deck.pop():makeCards(1)[0];
  Object.assign(state,{wordIndex:null,secretWord:"",clues:[],reviewerId:"",guess:"",votes:{},outcome:null});
  schedule(()=>chooseWord(currentPlayer().id,Math.floor(Math.random()*5)));sync();
}
function schedule(onTimeout,seconds=ACTION_SECONDS){hostTimer.clear();state.deadline=hostTimer.schedule(seconds,onTimeout);}
function chooseWord(id,index){
  if(state.phase!=="choose"||id!==currentPlayer().id||!Number.isInteger(index)||index<0||index>4)return;
  state.wordIndex=index;state.secretWord=state.choices[index];state.phase="clue";
  const slots=requiredClueSlots(state.players.length);state.clues=[];
  for(const p of state.players)if(p.id!==currentPlayer().id)for(let slot=0;slot<slots;slot++)state.clues.push({id:`${p.id}:${slot}`,playerId:p.id,slot,text:"",submitted:false,cancelled:false,reason:""});
  schedule(beginReview);sync();
}
function receiveClues(id,values){
  if(state.phase!=="clue"||id===currentPlayer().id)return;
  const mine=state.clues.filter((c)=>c.playerId===id);if(!mine.length||mine.every((c)=>c.submitted))return;
  const list=Array.isArray(values)?values:[];if(list.length!==mine.length)return;
  for(let i=0;i<mine.length;i++)if(validateClue(list[i],state.secretWord))return;
  mine.forEach((clue,i)=>{clue.text=normalizeText(list[i]);clue.submitted=true;});
  const activeIds=state.players.filter((p)=>p.id!==currentPlayer().id&&p.connected).map((p)=>p.id);
  if(activeIds.every((playerId)=>state.clues.filter((c)=>c.playerId===playerId).every((c)=>c.submitted)))beginReview();else sync();
}
function beginReview(){
  if(state.phase!=="clue")return;hostTimer.clear();state.phase="review";
  for(const clue of state.clues)if(!clue.submitted){clue.cancelled=true;clue.reason="未提交";}
  for(const ids of duplicateGroups(state.clues.filter((c)=>c.submitted)))for(const id of ids){const clue=state.clues.find((c)=>c.id===id);clue.cancelled=true;clue.reason="完全重复";}
  const host=state.players.find((p)=>p.isHost),guesser=currentPlayer();
  state.reviewerId=host.id!==guesser.id?host.id:state.players.slice(1).concat(state.players.slice(0,1)).find((p)=>p.id!==guesser.id&&p.connected)?.id||"";
  schedule(()=>finishReview(state.reviewerId,state.clues.filter((c)=>c.cancelled).map((c)=>c.id)));sync();
}
function finishReview(id,cancelledIds){
  if(state.phase!=="review"||id!==state.reviewerId)return;hostTimer.clear();const selected=new Set(Array.isArray(cancelledIds)?cancelledIds:[]);
  for(const clue of state.clues){if(!clue.submitted)continue;clue.cancelled=selected.has(clue.id);if(clue.cancelled&&!clue.reason)clue.reason="审查消除";if(!clue.cancelled)clue.reason="";}
  if(!state.clues.some((c)=>c.submitted&&!c.cancelled))return settle("pass");
  state.phase="guess";schedule(()=>settle("pass"));sync();
}
function receiveGuess(id,value){
  if(state.phase!=="guess"||id!==currentPlayer().id)return;const guess=normalizeText(value);if(!guess)return;
  hostTimer.clear();state.guess=guess;
  if(guess===normalizeText(state.secretWord))return settle("correct");
  state.phase="vote";state.votes={};schedule(resolveVote);sync();
}
function receiveVote(id,value){
  if(state.phase!=="vote"||id===currentPlayer().id||typeof value!=="boolean")return;
  const player=state.players.find((p)=>p.id===id);if(!player?.connected||id in state.votes)return;
  state.votes[id]=value;const eligible=eligibleVoters();
  if(Object.keys(state.votes).length>=eligible.length)resolveVote();else sync();
}
function eligibleVoters(){return state.players.filter((p)=>p.id!==currentPlayer().id&&p.connected).map((p)=>p.id);}
function resolveVote(){if(state.phase!=="vote")return;hostTimer.clear();settle(strictMajority(state.votes,eligibleVoters()).passed?"correct":"wrong");}
function settle(outcome){
  if(!["clue","review","guess","vote"].includes(state.phase))return;hostTimer.clear();state.outcome=outcome;
  if(outcome==="correct")state.correct+=1;else if(outcome==="wrong"){state.wrong+=1;if(state.gameMode==="classic"){if(state.deck.length)state.deck.pop();else if(state.correct>0)state.correct-=1;}}else state.passed+=1;
  state.history.push({round:state.round,guesserId:currentPlayer().id,word:state.secretWord,guess:state.guess,outcome,clues:state.clues.map((c)=>({...c}))});
  state.phase="reveal";schedule(nextRound,REVEAL_SECONDS);sync();
}
function nextRound(){if(state.phase!=="reveal")return;state.guesserIndex=(state.guesserIndex+1)%state.players.length;beginRound();}

function applyAction(id,action){
  if(!state||!action)return;
  if(action.type==="choose")return chooseWord(id,Number(action.index));
  if(action.type==="clues")return receiveClues(id,action.values);
  if(action.type==="review")return finishReview(id,action.cancelledIds);
  if(action.type==="guess")return receiveGuess(id,action.value);
  if(action.type==="pass"&&state.phase==="guess"&&id===currentPlayer().id)return settle("pass");
  if(action.type==="vote")return receiveVote(id,action.value);
}

function buildView(viewerId){
  const guesser=currentPlayer(),me=state.players.find((p)=>p.id===viewerId),canSeeWord=state.phase!=="choose"&&state.phase!=="lobby"&&(viewerId!==guesser?.id||["vote","reveal","ended"].includes(state.phase));
  const canSeeAllClues=["review","vote","reveal","ended"].includes(state.phase)&&viewerId!==guesser?.id||["vote","reveal","ended"].includes(state.phase);
  const visibleClues=state.phase==="guess"&&viewerId===guesser?.id?state.clues.filter((c)=>c.submitted&&!c.cancelled):canSeeAllClues?state.clues:state.clues.filter((c)=>c.playerId===viewerId);
  return {selfId:viewerId,phase:state.phase,capacity:state.capacity,gameMode:state.gameMode,players:state.players.map((p)=>({...p})),guesserIndex:state.guesserIndex,round:state.round,
    choices:state.phase==="choose"&&viewerId===guesser?.id?[1,2,3,4,5]:[],secretWord:canSeeWord?state.secretWord:"",clues:visibleClues.map((c)=>({...c})),reviewerId:state.reviewerId,
    guess:["vote","reveal","ended"].includes(state.phase)?state.guess:"",votes:Object.fromEntries(Object.keys(state.votes).map((id)=>[id,true])),outcome:state.outcome,
    correct:state.correct,wrong:state.wrong,passed:state.passed,remaining:state.gameMode==="classic"?state.deck.length:null,deadline:state.deadline,
    history:state.history.map((r)=>({...r,clues:r.clues.map((c)=>({...c}))}))};
}

function renderLobby(view){E.lobbyArea.innerHTML=`<h2>玩家 ${view.players.length} / ${view.capacity}</h2>${view.players.map((p,i)=>`<div class="lobby-player"><i class="dot ${p.connected?"online":""}"></i><b>${i+1}. ${escapeHtml(p.name)}${p.isHost?" · 房主":""}</b>${mode==="host"&&!p.isHost?`<button data-kick="${p.id}">移出</button>`:""}</div>`).join("")}<p>模式：${view.gameMode==="classic"?"经典 13 卡":"不限轮休闲"}</p>`;E.lobbyArea.querySelectorAll("[data-kick]").forEach((b)=>b.onclick=()=>kickPlayer(b.dataset.kick));}
function renderPlayers(view){E.playerList.innerHTML=view.players.map((p,i)=>`<div class="player-row ${i===view.guesserIndex?"active":""}">${escapeHtml(p.name)}${i===view.guesserIndex?" · 猜词":""}${!p.connected?" · 离线":""}</div>`).join("");}
function clueCards(clues,interactive=false){return clues.map((c)=>`<button class="clue-card ${c.cancelled?"cancelled":""}" data-clue="${c.id}" ${interactive?"":"disabled"}>${escapeHtml(c.text||"未提交")}<small>${escapeHtml(c.reason||"")}</small></button>`).join("");}
function renderHistory(view){E.historyList.innerHTML=[...view.history].reverse().map((r)=>{const g=view.players.find((p)=>p.id===r.guesserId);return `<div class="record"><b>第 ${r.round} 轮</b><span>${escapeHtml(g?.name||"")}：${escapeHtml(r.guess||"放弃")} / ${escapeHtml(r.word)}</span><strong>${r.outcome==="correct"?"✓ 正确":r.outcome==="wrong"?"✕ 错误":"— 放弃"}</strong></div>`;}).join("")||"尚无记录";}
function renderStage(view){
  const me=view.players.find((p)=>p.id===view.selfId),guesser=view.players[view.guesserIndex],isGuesser=me?.id===guesser?.id;
  const titles={choose:"选择秘密词",clue:"书写独特提示",review:"消除重复提示",guess:"唯一一次猜测",vote:"共同裁定答案",reveal:"本轮揭晓"};E.stageTitle.textContent=titles[view.phase]||"游戏结束";
  E.roleBadge.textContent=isGuesser?"你是猜词者":view.reviewerId===view.selfId?"你负责审查":"提示者";setHidden(E.secretWord,!view.secretWord);E.secretWord.textContent=view.secretWord?`秘密词：${view.secretWord}`:"";
  for(const area of [E.choiceArea,E.clueArea,E.reviewArea,E.guessArea,E.voteArea,E.revealArea])setHidden(area,true);E.waitingText.textContent="";
  if(view.phase==="choose"){if(isGuesser){setHidden(E.choiceArea,false);E.choiceArea.innerHTML=view.choices.map((n,i)=>`<button data-choice="${i}">${n}</button>`).join("");E.choiceArea.querySelectorAll("button").forEach((b)=>b.onclick=()=>submit({type:"choose",index:Number(b.dataset.choice)}));}else E.waitingText.textContent=`等待 ${guesser.name} 选择 1～5。`;}
  if(view.phase==="clue"){if(isGuesser)E.waitingText.textContent="其他玩家正在秘密书写提示……";else{const mine=view.clues;setHidden(E.clueArea,false);E.clueInputs.innerHTML=mine.map((_,i)=>`<label>提示 ${i+1}<input maxlength="8" data-slot="${i}" autocomplete="off"></label>`).join("");E.submitCluesButton.disabled=mine.every((c)=>c.submitted);}}
  if(view.phase==="review"){if(view.selfId===view.reviewerId){setHidden(E.reviewArea,false);if(!reviewSelection.size)reviewSelection=new Set(view.clues.filter((c)=>c.cancelled).map((c)=>c.id));E.reviewClues.innerHTML=clueCards(view.clues,true);E.reviewClues.querySelectorAll("[data-clue]").forEach((b)=>b.onclick=()=>{reviewSelection.has(b.dataset.clue)?reviewSelection.delete(b.dataset.clue):reviewSelection.add(b.dataset.clue);b.classList.toggle("cancelled");});}else E.waitingText.textContent=isGuesser?"提示正在审查，不能偷看哦。":"等待审查员确认同词根和违规提示。";}
  if(view.phase==="guess"){if(isGuesser){setHidden(E.guessArea,false);E.visibleClues.innerHTML=clueCards(view.clues);E.guessInput.value="";}else E.waitingText.textContent=`${guesser.name} 正在根据剩余提示猜词。`;}
  if(view.phase==="vote"){if(isGuesser)E.waitingText.textContent="其他玩家正在裁定你的答案。";else{setHidden(E.voteArea,false);E.voteQuestion.innerHTML=`回答 <b>${escapeHtml(view.guess)}</b>，答案是 <b>${escapeHtml(view.secretWord)}</b>，是否应算正确？`;const voted=view.votes[view.selfId];E.voteYesButton.disabled=E.voteNoButton.disabled=Boolean(voted);E.voteStatus.textContent=voted?"你已投票，等待其他玩家。":"严格多数赞成才算正确。";}}
  if(view.phase==="reveal"){setHidden(E.revealArea,false);E.revealArea.innerHTML=`<div class="secret">${escapeHtml(view.secretWord)}</div><p>猜测：${escapeHtml(view.guess||"主动放弃")}</p><h2>${view.outcome==="correct"?"猜对了！":view.outcome==="wrong"?"没有猜中":"本轮放弃"}</h2><div class="clue-board">${clueCards(view.clues)}</div>`;}
}
function render(){
  const view=currentView();if(!view)return;const lobby=view.phase==="lobby",ended=view.phase==="ended";E.roomCodeDisplay.textContent=room.snapshot().roomCode;E.phaseBadge.textContent={lobby:"等待玩家",choose:"选择数字",clue:"填写提示",review:"审查提示",guess:"猜词",vote:"投票裁定",reveal:"回合揭晓",ended:"游戏结束"}[view.phase];E.roundText.textContent=`第 ${view.round} 轮`;
  setHidden(E.lobbyArea,!lobby);setHidden(E.gameArea,lobby||ended);setHidden(E.resultPanel,!ended);setHidden(E.startGameButton,!lobby);E.startGameButton.disabled=mode!=="host"||view.players.length!==view.capacity||view.players.some((p)=>!p.connected);setHidden(E.endGameButton,mode!=="host"||lobby);E.endGameButton.textContent=ended?"返回大厅":"结束游戏";
  E.notice.textContent=lobby?`等待 ${view.capacity} 位玩家到齐。`:ended?"本局已经结束。":`${view.players[view.guesserIndex]?.name||""} 是本轮猜词者。`;renderLobby(view);renderPlayers(view);renderHistory(view);
  E.scoreDisplay.textContent=view.correct;E.statsDisplay.innerHTML=`正确 ${view.correct}<br>错误 ${view.wrong}<br>放弃 ${view.passed}${view.remaining===null?`<br>正确率 ${view.round?Math.round(view.correct/view.round*100):0}%`:`<br>剩余卡 ${view.remaining}`}`;
  if(!lobby&&!ended)renderStage(view);if(ended){const completed=view.history.length;E.resultTitle.textContent=view.gameMode==="classic"?scoreLabel(view.correct):`完成 ${completed} 轮`;E.resultStats.innerHTML=`<div class="score">${view.correct}</div><p>正确 ${view.correct} · 错误 ${view.wrong} · 放弃 ${view.passed}${view.gameMode==="casual"?` · 正确率 ${completed?Math.round(view.correct/completed*100):0}%`:""}</p>`;}
  if(view.deadline){countdown.start(view.deadline,(["reveal"].includes(view.phase)?REVEAL_SECONDS:ACTION_SECONDS)*1000);setHidden(E.timerWrap,false);}else{countdown.stop();setHidden(E.timerWrap,true);}
}

E.hostModeButton.onclick=()=>{mode="host";setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});};E.guestModeButton.onclick=()=>{mode="guest";setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});};
E.createRoomButton.onclick=createGameRoom;E.joinRoomButton.onclick=joinGameRoom;E.startGameButton.onclick=startGame;E.endGameButton.onclick=endOrReset;
E.submitCluesButton.onclick=()=>{const values=[...E.clueInputs.querySelectorAll("input")].map((input)=>input.value);const view=currentView();for(const value of values){const error=validateClue(value,view.secretWord);if(error)return alert(error);}submit({type:"clues",values});};
E.finishReviewButton.onclick=()=>{submit({type:"review",cancelledIds:[...reviewSelection]});reviewSelection=new Set();};E.submitGuessButton.onclick=()=>submit({type:"guess",value:E.guessInput.value});E.passButton.onclick=()=>submit({type:"pass"});E.voteYesButton.onclick=()=>submit({type:"vote",value:true});E.voteNoButton.onclick=()=>submit({type:"vote",value:false});
bindRoomCodeInput(E.roomCodeInput);setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});room.checkServer().catch(()=>{});
