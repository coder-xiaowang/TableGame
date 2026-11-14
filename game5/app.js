"use strict";

import {
  bindRoomCodeInput,cleanPlayerName,createAuthoritativeRoomClient,createCountdown,createRoomEntryController,
  createPresentationTimeline,createSessionStore,createSpectatorUi,escapeHtml,renderConnectionStatus,renderCountdown,setHidden,setModeVisibility
} from "/shared/client/index.js";
import {ACTION_SECONDS,COLOR_NAMES} from "./rules.mjs";
import {composePresentationText} from "./presentation.mjs";
import {createGame5PartitionRenderer,createGame5RenderModel} from "./render-partitions.mjs";

const PROTOCOL_VERSION=3;
const $=(id)=>document.getElementById(id);
const E=Object.fromEntries([
  "siteHeader","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup",
  "hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField",
  "roomCodeDisplay","rulesShortcutButton","rulesCard","hostTools","roomPlayerCountSelect","spectatorSettingButton","seatActionButton","spectatorPanel","spectatorCountBadge","spectatorList","startGameButton","endGameButton","notice","directionText",
  "deckCount","players","drawPile","discardPile","currentColor","penaltyBanner","actionTitle","timerText","timerBar",
  "actionArea","handPanel","handCount","unoButton","hand","logList","toggleLogButton","colorModal","cancelColorButton",
  "unoStage","tableStage","presentationEffects","presentationTrail","presentationAnnouncement","presentationLabel","presentationText"
].map((id)=>[id,$(id)]));

let mode="host";
let view=null;
let pendingCardId=null;
let spectatorUi=null;
let presentation=null;
let partitionRenderer=null;
const sessions=createSessionStore({gameId:"uno"});
const countdown=createCountdown({onTick(value){renderCountdown({textElement:E.timerText,barElement:E.timerBar},value);}});
const room=createAuthoritativeRoomClient({
  protocolVersion:PROTOCOL_VERSION,sessionStore:sessions,
  onStatus(status){renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode);},
  handlers:{
    onView(nextView){view=nextView;enterRoom();render();presentation?.sync(nextView.presentationEvents);},
    onKicked(){spectatorUi?.handleSessionEnded("kicked");},
    onRoomExpired(){spectatorUi?.handleSessionEnded("room_expired");}
  }
});

spectatorUi=createSpectatorUi({
  room,getView:()=>view,
  elements:{joinIntentField:E.joinIntentField,seatActionButton:E.seatActionButton,spectatorSettingButton:E.spectatorSettingButton,spectatorPanel:E.spectatorPanel,spectatorCountBadge:E.spectatorCountBadge,spectatorList:E.spectatorList},
  notify:(message)=>alert(message),confirmAction:(message)=>confirm(message),onSessionEnded:()=>location.reload()
});
const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建房间失败：${error.message}\n请确认已通过 node game5/signal-server.js 启动。`:`加入房间失败：${error.message}`});

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
function renderPlayers(model){const current=model.view,existing=new Map([...E.players.querySelectorAll("[data-player-id]")].map((node)=>[node.dataset.playerId,node])),retained=new Set();current.players.forEach((player,index)=>{let node=existing.get(String(player.id));if(!node){node=document.createElement("div");node.dataset.playerId=String(player.id);node.innerHTML='<div class="player-name"><span data-name></span><b data-count></b></div><div class="player-meta" data-meta></div><div class="mini-cards" data-mini></div><button class="kick-player hidden" data-kick type="button">移出</button>';node.querySelector("[data-kick]").onclick=()=>kickPlayer(node.dataset.playerId);}retained.add(String(player.id));node.className=`player ${index===current.currentIndex&&current.phase==="playing"?"turn":""}`;node.querySelector("[data-name]").textContent=player.name;node.querySelector("[data-count]").textContent=`${player.hand.length} 张`;node.querySelector("[data-meta]").textContent=`${player.isHost?"房主 · ":""}${player.connected?"在线":"离线"}${player.id===current.unoVulnerableId?" · 可抓UNO":player.unoCalled?" · 已喊UNO":""}`;const mini=node.querySelector("[data-mini]");if(mini.dataset.count!==String(player.hand.length)){mini.innerHTML=player.hand.slice(0,18).map(()=>'<i class="mini-card"></i>').join("");mini.dataset.count=String(player.hand.length);}setHidden(node.querySelector("[data-kick]"),!current.permissions?.canKick||player.isHost);const at=E.players.children[index];if(at!==node)E.players.insertBefore(node,at||null);});[...E.players.querySelectorAll("[data-player-id]")].forEach((node)=>{if(!retained.has(node.dataset.playerId))node.remove();});}
function addAction(text,className,type){const button=document.createElement("button");button.textContent=text;button.dataset.action=type;if(className)button.className=className;button.onclick=()=>submit({type});E.actionArea.append(button);}
function renderDecision(model){const current=model.view;E.actionArea.innerHTML="";if(model.memberRole==="spectator"){E.actionArea.innerHTML='<p class="muted spectator-action-note">旁观模式只显示公共牌桌、手牌数量和公开记录，不能摸牌、出牌、质疑或抓 UNO。</p>';return;}if(current.phase!=="playing")return;if(current.permissions.canCatchUno)addAction("抓 UNO！","challenge","catchUno");if(!model.myTurn)return;if(current.permissions.canChallenge)addAction("质疑上一张 +4","challenge","challenge");if(current.permissions.canAcceptPenalty)addAction("","accept","acceptPenalty");else if(current.permissions.canPass)addAction("保留摸到的牌并结束回合","","pass");else if(current.permissions.canDraw)addAction("摸一张牌","primary","draw");}
function renderDecisionFacts(model){const current=model.view;E.actionTitle.textContent=model.memberRole==="spectator"?(current.phase==="lobby"?"旁观准备阶段":"正在旁观牌局"):current.phase==="ended"?"本局结束":current.phase==="lobby"?"等待开始":model.myTurn?"轮到你了":`等待 ${model.current?.name||"玩家"}`;const accept=E.actionArea.querySelector('[data-action="acceptPenalty"]');if(accept)accept.textContent=`接受并摸 ${current.pendingDraw} 张`;}
function chooseCard(card){
  if(card.type==="wild"||card.type==="wild4"){
    pendingCardId=card.id;setHidden(E.colorModal,false);return;
  }
  submit({type:"play",cardId:card.id});
}
function renderRoom(model){const current=model.view;setHidden(E.hostTools,!current.permissions?.canManage);setHidden(E.startGameButton,!current.permissions?.canStart);setHidden(E.endGameButton,!current.permissions?.canEnd);E.roomPlayerCountSelect.value=String(current.capacity);E.roomPlayerCountSelect.disabled=!current.permissions?.canSetCapacity;E.startGameButton.disabled=current.players.length!==current.capacity||current.players.some((player)=>!player.connected);E.roomCodeDisplay.textContent=model.roomCode;}
function renderStatus(model){const current=model.view;if(current.phase==="lobby")E.notice.textContent=model.memberRole==="spectator"?"你正在旁观准备阶段，可在有空位时进入玩家席。":current.players.length===current.capacity?"玩家已经到齐，房主可以开始。":`等待玩家加入：${current.players.length}/${current.capacity}`;else if(current.phase==="ended")E.notice.textContent=`${current.players.find((player)=>player.id===current.winnerId)?.name||"玩家"} 打完了所有牌，获得本局胜利！`;else E.notice.textContent=`轮到 ${model.current?.name||"玩家"}，每次行动限时15秒。`;}
function renderTable(model){const current=model.view;E.directionText.textContent=current.direction===1?"顺时针 ↻":"逆时针 ↺";E.deckCount.textContent=current.deckCount;E.discardPile.innerHTML=current.discard[0]?cardHtml(current.discard[0]):"";E.currentColor.textContent=`当前颜色：${COLOR_NAMES[current.currentColor]||"—"}`;E.currentColor.style.color={red:"#c92525",yellow:"#9a7200",green:"#168843",blue:"#176db7"}[current.currentColor]||"";setHidden(E.penaltyBanner,!current.pendingDraw);E.penaltyBanner.textContent=`累计罚牌 +${current.pendingDraw}：可继续叠加 +2 / +4`;E.drawPile.disabled=!current.permissions?.canDraw;E.drawPile.onclick=current.permissions?.canDraw?()=>submit({type:"draw"}):null;}
function bindHandCard(node,card){node.onclick=()=>chooseCard(card);}
function renderHand(model){const current=model.view,me=model.me;setHidden(E.handPanel,model.memberRole==="spectator");if(model.memberRole==="spectator")return;E.handCount.textContent=me?.hand.length||0;const playable=new Set(current.playableCardIds||[]),existing=new Map([...E.hand.querySelectorAll("[data-card]")].map((node)=>[node.dataset.card,node])),retained=new Set();(me?.hand||[]).forEach((card,index)=>{let node=existing.get(card.id);if(!node){const template=document.createElement("template");template.innerHTML=cardHtml(card,{button:true,enabled:playable.has(card.id)});node=template.content.firstElementChild;bindHandCard(node,card);}retained.add(card.id);const enabled=playable.has(card.id);node.classList.toggle("playable",enabled);node.disabled=!enabled;const at=E.hand.children[index];if(at!==node)E.hand.insertBefore(node,at||null);});[...E.hand.querySelectorAll("[data-card]")].forEach((node)=>{if(!retained.has(node.dataset.card))node.remove();});E.unoButton.disabled=!current.permissions?.canCallUno;E.unoButton.classList.toggle("called",Boolean(me?.unoCalled));E.unoButton.textContent=me?.unoCalled?"已喊 UNO！":"喊 UNO！";}
function renderLog(model){E.logList.innerHTML=model.view.logs.map((entry)=>`<div class="log-item">${escapeHtml(entry.text)}</div>`).join("");}
function renderCountdownPartition(model){if(model.view.deadline)countdown.start(model.view.deadline,ACTION_SECONDS*1000);else{countdown.stop();E.timerText.textContent="--";E.timerBar.style.width="0";}}
function render(){
  if(!view)return;
  const spectatorModel=spectatorUi.render(view),memberRole=spectatorModel.memberRole,model=createGame5RenderModel(view,{memberRole,roomCode:room.snapshot().roomCode});
  partitionRenderer??=createGame5PartitionRenderer({room:renderRoom,status:renderStatus,players:renderPlayers,table:renderTable,decision:renderDecision,decisionFacts:renderDecisionFacts,hand:renderHand,log:renderLog,countdown:renderCountdownPartition});partitionRenderer.render(model);
  if(memberRole==="spectator"||(pendingCardId&&!model.me?.hand.some((card)=>card.id===pendingCardId))){pendingCardId=null;setHidden(E.colorModal,true);}
}
function playerFor(playerId){
  if(!playerId)return null;
  return [...E.players.querySelectorAll(".player")].find((player)=>player.dataset.playerId===String(playerId))||null;
}
function presentationSource(event){
  if(["private-draw","initial-hand","game-start"].includes(event.kind))return E.drawPile;
  if(event.kind==="deck-recycled")return E.discardPile;
  if(["turn-start","game-won"].includes(event.kind))return E.tableStage;
  return playerFor(event.actorId)||E.tableStage;
}
function presentationTarget(event){
  if(["private-draw","initial-hand"].includes(event.kind))return E.handPanel;
  if(["game-start","card-play"].includes(event.kind))return E.discardPile;
  if(event.kind==="deck-recycled")return E.drawPile;
  return playerFor(event.targetId||event.actorId)||E.tableStage;
}
function presentationLabel(kind){
  return ({
    "game-start":"UNO 开局","turn-start":"轮到行动","card-play":"打出卡牌","penalty-window":"罚牌来袭",
    "penalty-accepted":"接受罚牌","challenge-start":"质疑 +4","challenge-result":"质疑结算","player-skipped":"跳过回合",
    "direction-reversed":"方向反转","draw-action":"摸牌","draw-pass":"保留摸牌","private-draw":"你的摸牌",
    "initial-hand":"领取手牌","uno-call":"UNO！","uno-vulnerable":"等待抢喊","uno-caught":"抓到 UNO",
    "deck-recycled":"重新洗牌","game-won":"本局胜利"
  })[kind]||"牌桌事件";
}
function playPresentationObject(event){
  const source=presentationSource(event);const target=presentationTarget(event);
  source?.classList.add("presentation-source");target?.classList.add("presentation-target");
  E.unoStage?.classList.toggle("presentation-reverse",event.kind==="direction-reversed");
  const token=document.createElement("span");
  token.className=`presentation-token ${event.private?"private":""}`;
  const events=event.sceneEvents||[event];
  const played=events.find((item)=>item.card);
  const privateCards=events.find((item)=>item.private&&Array.isArray(item.cards)&&item.cards.length);
  token.classList.toggle("private",Boolean(privateCards));
  if(played?.card)token.textContent=cardText(played.card);
  else if(privateCards)token.textContent=privateCards.cards.map(cardText).join(" · ");
  else if(event.card)token.textContent=cardText(event.card);
  else if(Array.isArray(event.cards)&&event.cards.length)token.textContent=event.cards.map(cardText).join(" · ");
  else token.textContent=event.count?`+${event.count}`:({"turn-start":"▶","direction-reversed":"↻","uno-call":"UNO!","uno-caught":"UNO!","game-won":"★"})[event.kind]||"UNO";
  E.presentationEffects?.append(token);
  return()=>{source?.classList.remove("presentation-source");target?.classList.remove("presentation-target");E.unoStage?.classList.remove("presentation-reverse");token.remove();};
}
presentation=createPresentationTimeline({
  container:E.presentationEffects,trailPath:E.presentationTrail,announcement:E.presentationAnnouncement,
  labelElement:E.presentationLabel,textElement:E.presentationText,effectsElement:E.presentationEffects,
  resolveSource:presentationSource,resolveTarget:presentationTarget,labelFor:(event)=>presentationLabel(event.kind),
  textFor:composePresentationText,beforePlay:playPresentationObject,durationMs:1000,reducedDurationMs:450,maxQueue:18,
  sceneKey:(event)=>event.sceneId||event.id,priorityFor:(event)=>Number(event.priority)||0,
  catchUpThreshold:2,severeBacklogThreshold:5,catchUpDurationMs:520,severeDurationMs:280,
  urgentPriority:4,retainPriority:3
});
function endGame(){if(confirm("确定结束当前游戏并返回准备阶段吗？本局进度将被清空。"))submit({type:"end"});}
async function init(){
  roomEntry.bind();
  spectatorUi.bind();
  E.roomPlayerCountSelect.addEventListener("change",()=>submit({type:"setCapacity",capacity:Number(E.roomPlayerCountSelect.value)}));
  E.startGameButton.addEventListener("click",()=>submit({type:"start"}));E.endGameButton.addEventListener("click",endGame);
  E.rulesShortcutButton.addEventListener("click",()=>{E.rulesCard.open=true;E.rulesCard.scrollIntoView({behavior:"smooth",block:"start"});});
  E.unoButton.addEventListener("click",()=>submit({type:"callUno"}));E.toggleLogButton.addEventListener("click",()=>E.logList.classList.toggle("collapsed"));
  E.cancelColorButton.addEventListener("click",()=>{pendingCardId=null;setHidden(E.colorModal,true);});
  E.colorModal.querySelectorAll("[data-color]").forEach((button)=>button.addEventListener("click",()=>{if(pendingCardId)submit({type:"play",cardId:pendingCardId,color:button.dataset.color});pendingCardId=null;setHidden(E.colorModal,true);}));
  selectMode("host");try{spectatorUi.applyConfig(await room.checkServer());}catch{/* create/join presents details */}
}
init();
