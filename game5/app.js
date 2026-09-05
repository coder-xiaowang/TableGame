"use strict";

import {
  bindRoomCodeInput,cleanPlayerName,createAuthoritativeRoomClient,createCountdown,
  createSessionStore,createSpectatorUi,escapeHtml,renderConnectionStatus,renderCountdown,setHidden,setModeVisibility
} from "/shared/client/index.js";
import {ACTION_SECONDS,COLOR_NAMES} from "./rules.mjs";

const PROTOCOL_VERSION=3;
const $=(id)=>document.getElementById(id);
const E=Object.fromEntries([
  "siteHeader","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup",
  "hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField",
  "roomCodeDisplay","hostTools","roomPlayerCountSelect","spectatorSettingButton","seatActionButton","spectatorPanel","spectatorCountBadge","spectatorList","startGameButton","endGameButton","notice","directionText",
  "deckCount","players","drawPile","discardPile","currentColor","penaltyBanner","actionTitle","timerText","timerBar",
  "actionArea","handPanel","handCount","unoButton","hand","logList","toggleLogButton","colorModal","cancelColorButton"
].map((id)=>[id,$(id)]));

let mode="host";
let view=null;
let pendingCardId=null;
let spectatorUi=null;
const sessions=createSessionStore({gameId:"uno"});
const countdown=createCountdown({onTick(value){renderCountdown({textElement:E.timerText,barElement:E.timerBar},value);}});
const room=createAuthoritativeRoomClient({
  protocolVersion:PROTOCOL_VERSION,sessionStore:sessions,
  onStatus(status){renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode);},
  handlers:{
    onView(nextView){view=nextView;enterRoom();render();},
    onKicked(){spectatorUi?.handleSessionEnded("kicked");},
    onRoomExpired(){spectatorUi?.handleSessionEnded("room_expired");}
  }
});

spectatorUi=createSpectatorUi({
  room,getView:()=>view,
  elements:{joinIntentField:E.joinIntentField,seatActionButton:E.seatActionButton,spectatorSettingButton:E.spectatorSettingButton,spectatorPanel:E.spectatorPanel,spectatorCountBadge:E.spectatorCountBadge,spectatorList:E.spectatorList},
  notify:(message)=>alert(message),confirmAction:(message)=>confirm(message),onSessionEnded:()=>location.reload()
});

function enterRoom(){setHidden(E.setupPanel,true);setHidden(E.roomPanel,false);setHidden(E.roomHeaderTools,false);E.siteHeader.classList.add("in-room");setHidden(E.hostTools,!view?.permissions?.canManage);E.roomCodeDisplay.textContent=room.snapshot().roomCode;}
function selectMode(nextMode){mode=nextMode;setModeVisibility(mode,{hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostButton:E.hostModeButton,guestButton:E.guestModeButton});}
async function createGameRoom(){
  E.createRoomButton.disabled=true;
  try{await room.createRoom({name:cleanPlayerName(E.hostNameInput.value,"房主"),capacity:Number(E.playerCountSelect.value)});}
  catch(error){alert(`创建房间失败：${error.message}\n请确认已通过 node game5/signal-server.js 启动。`);}
  finally{E.createRoomButton.disabled=false;}
}
async function joinGameRoom(){
  E.joinRoomButton.disabled=true;
  try{const result=await room.joinRoom({code:E.roomCodeInput.value,name:cleanPlayerName(E.guestNameInput.value,"玩家"),intent:spectatorUi.getJoinIntent()});E.connectionStatus.textContent=spectatorUi.handleJoinResult(result).statusText;}
  catch(error){alert(`加入房间失败：${error.message}`);}
  finally{E.joinRoomButton.disabled=false;}
}
function submit(action){return Promise.resolve(room.submitAction(action)).catch((error)=>{E.connectionStatus.textContent=`操作失败：${error.message}`;alert(error.message);});}
async function kickPlayer(playerId){
  const player=view?.players.find((item)=>item.id===playerId);
  if(!player||player.isHost||!confirm(`确定要移出 ${player.name} 吗？其手牌会洗回摸牌堆。`))return;
  try{await room.kick(playerId);}catch(error){alert(`移出失败：${error.message}`);}
}
function cardText(card){return card.type==="number"?card.value:{skip:"⊘",reverse:"↻",draw2:"+2",wild:"WILD",wild4:"+4"}[card.type];}
function cardHtml(card,{button=false,enabled=false}={}){
  if(card===null)return '<div class="uno-card wild"><span class="value">UNO</span></div>';
  const tag=button?"button":"div";
  return `<${tag} class="uno-card ${card.color||"wild"} ${enabled?"playable":""}" ${button?`data-card="${escapeHtml(card.id)}" ${enabled?"":"disabled"}`:""}><span class="value">${cardText(card)}</span><span class="symbol"></span></${tag}>`;
}
function currentPlayer(){return view?.players[view.currentIndex]||null;}
function renderPlayers(){
  E.players.innerHTML=view.players.map((player,index)=>`<div class="player ${index===view.currentIndex&&view.phase==="playing"?"turn":""}">
    <div class="player-name"><span>${escapeHtml(player.name)}</span><b>${player.hand.length} 张</b></div>
    <div class="player-meta">${player.isHost?"房主 · ":""}${player.connected?"在线":"离线"}${player.id===view.unoVulnerableId?" · 可抓UNO":player.unoCalled?" · 已喊UNO":""}</div>
    <div class="mini-cards">${player.hand.slice(0,18).map(()=>'<i class="mini-card"></i>').join("")}</div>
    ${view.permissions?.canKick&&!player.isHost?`<button class="kick-player" data-player-id="${escapeHtml(player.id)}" type="button">移出</button>`:""}
  </div>`).join("");
  E.players.querySelectorAll("[data-player-id]").forEach((button)=>button.addEventListener("click",()=>kickPlayer(button.dataset.playerId)));
}
function renderActions(memberRole){
  const current=currentPlayer();
  const myTurn=view.phase==="playing"&&current?.id===view.selfId;
  E.actionTitle.textContent=view.phase==="ended"?"本局结束":view.phase==="lobby"?"等待开始":myTurn?"轮到你了":`等待 ${current?.name||"玩家"}`;
  E.actionArea.innerHTML="";
  if(memberRole==="spectator"){
    E.actionTitle.textContent=view.phase==="lobby"?"旁观准备阶段":"正在旁观牌局";
    E.actionArea.innerHTML='<p class="muted spectator-action-note">旁观模式只显示公共牌桌、手牌数量和公开记录，不能摸牌、出牌、质疑或抓 UNO。</p>';
    return;
  }
  if(view.phase!=="playing")return;
  const addButton=(text,className,action)=>{const button=document.createElement("button");button.textContent=text;if(className)button.className=className;button.addEventListener("click",()=>submit(action));E.actionArea.append(button);};
  if(view.permissions.canCatchUno)addButton("抓 UNO！","challenge",{type:"catchUno"});
  if(!myTurn)return;
  if(view.permissions.canChallenge)addButton("质疑上一张 +4","challenge",{type:"challenge"});
  if(view.permissions.canAcceptPenalty)addButton(`接受并摸 ${view.pendingDraw} 张`,"accept",{type:"acceptPenalty"});
  else if(view.permissions.canPass)addButton("保留摸到的牌并结束回合","",{type:"pass"});
  else if(view.permissions.canDraw)addButton("摸一张牌","primary",{type:"draw"});
}
function chooseCard(card){
  if(card.type==="wild"||card.type==="wild4"){
    pendingCardId=card.id;setHidden(E.colorModal,false);return;
  }
  submit({type:"play",cardId:card.id});
}
function render(){
  if(!view)return;
  const spectatorModel=spectatorUi.render(view);const memberRole=spectatorModel.memberRole;
  const me=view.players.find((player)=>player.id===view.selfId);
  const current=currentPlayer();
  setHidden(E.hostTools,!view.permissions?.canManage);
  setHidden(E.startGameButton,!view.permissions?.canStart);
  setHidden(E.endGameButton,!view.permissions?.canEnd);
  E.roomPlayerCountSelect.value=String(view.capacity);
  E.roomPlayerCountSelect.disabled=!view.permissions?.canSetCapacity;
  E.startGameButton.disabled=view.players.length!==view.capacity||view.players.some((player)=>!player.connected);
  E.roomCodeDisplay.textContent=room.snapshot().roomCode;
  E.directionText.textContent=view.direction===1?"顺时针 ↻":"逆时针 ↺";
  E.deckCount.textContent=view.deckCount;
  renderPlayers();
  E.discardPile.innerHTML=view.discard[0]?cardHtml(view.discard[0]):"";
  E.currentColor.textContent=`当前颜色：${COLOR_NAMES[view.currentColor]||"—"}`;
  E.currentColor.style.color={red:"#c92525",yellow:"#9a7200",green:"#168843",blue:"#176db7"}[view.currentColor]||"";
  setHidden(E.penaltyBanner,!view.pendingDraw);
  E.penaltyBanner.textContent=`累计罚牌 +${view.pendingDraw}：可继续叠加 +2 / +4`;
  if(view.phase==="lobby")E.notice.textContent=memberRole==="spectator"?"你正在旁观准备阶段，可在有空位时进入玩家席。":view.players.length===view.capacity?"玩家已经到齐，房主可以开始。":`等待玩家加入：${view.players.length}/${view.capacity}`;
  else if(view.phase==="ended")E.notice.textContent=`${view.players.find((player)=>player.id===view.winnerId)?.name||"玩家"} 打完了所有牌，获得本局胜利！`;
  else E.notice.textContent=`轮到 ${current?.name||"玩家"}，每次行动限时15秒。`;
  setHidden(E.handPanel,memberRole==="spectator");
  E.handCount.textContent=me?.hand.length||0;
  const playableIds=new Set(view.playableCardIds||[]);
  E.hand.innerHTML=(me?.hand||[]).map((card)=>cardHtml(card,{button:true,enabled:playableIds.has(card.id)})).join("");
  E.hand.querySelectorAll("[data-card]").forEach((button)=>button.addEventListener("click",()=>chooseCard(me.hand.find((card)=>card.id===button.dataset.card))));
  E.unoButton.disabled=!view.permissions?.canCallUno;
  E.unoButton.classList.toggle("called",Boolean(me?.unoCalled));
  E.unoButton.textContent=me?.unoCalled?"已喊 UNO！":"喊 UNO！";
  E.drawPile.disabled=!view.permissions?.canDraw;
  E.drawPile.onclick=view.permissions?.canDraw?()=>submit({type:"draw"}):null;
  renderActions(memberRole);
  E.logList.innerHTML=view.logs.map((entry)=>`<div class="log-item">${escapeHtml(entry.text)}</div>`).join("");
  if(memberRole==="spectator"||(pendingCardId&&!me?.hand.some((card)=>card.id===pendingCardId))){pendingCardId=null;setHidden(E.colorModal,true);}
  if(view.deadline)countdown.start(view.deadline,ACTION_SECONDS*1000);else{countdown.stop();E.timerText.textContent="--";E.timerBar.style.width="0";}
}
function endGame(){if(confirm("确定结束当前游戏并返回准备阶段吗？本局进度将被清空。"))submit({type:"end"});}
async function init(){
  bindRoomCodeInput(E.roomCodeInput);
  spectatorUi.bind();
  E.hostModeButton.addEventListener("click",()=>selectMode("host"));E.guestModeButton.addEventListener("click",()=>selectMode("guest"));
  E.createRoomButton.addEventListener("click",createGameRoom);E.joinRoomButton.addEventListener("click",joinGameRoom);
  E.roomPlayerCountSelect.addEventListener("change",()=>submit({type:"setCapacity",capacity:Number(E.roomPlayerCountSelect.value)}));
  E.startGameButton.addEventListener("click",()=>submit({type:"start"}));E.endGameButton.addEventListener("click",endGame);
  E.unoButton.addEventListener("click",()=>submit({type:"callUno"}));E.toggleLogButton.addEventListener("click",()=>E.logList.classList.toggle("collapsed"));
  E.cancelColorButton.addEventListener("click",()=>{pendingCardId=null;setHidden(E.colorModal,true);});
  E.colorModal.querySelectorAll("[data-color]").forEach((button)=>button.addEventListener("click",()=>{if(pendingCardId)submit({type:"play",cardId:pendingCardId,color:button.dataset.color});pendingCardId=null;setHidden(E.colorModal,true);}));
  selectMode("host");try{spectatorUi.applyConfig(await room.checkServer());}catch{/* create/join presents details */}
}
init();
