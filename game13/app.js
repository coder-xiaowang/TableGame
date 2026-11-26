"use strict";

import {
  bindRoomCodeInput,cleanPlayerName,createAuthoritativeRoomClient,createCountdown,createRoomEntryController,
  createPresentationTimeline,createSessionStore,createSpectatorUi,escapeHtml,renderConnectionStatus,renderCountdown,serverNow,setHidden,setModeVisibility
} from "/shared/client/index.js";
import {ACTION_SECONDS,POWER_NAMES} from "./rules.mjs";
import {createGame13PartitionRenderer,createGame13RenderModel} from "./render-partitions.mjs";

const PROTOCOL_VERSION=3;
const $=(id)=>document.getElementById(id);
const ids=["hero","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField","roomCodeDisplay","hostTools","roomPlayerCountSelect","spectatorSettingButton","seatActionButton","spectatorPanel","spectatorCountBadge","spectatorList","startGameButton","endGameButton","scoreboard","notice","targetNotice","roundNumber","phaseLabel","deckCount","discardCount","discardPile","drawPile","pendingWrap","pendingCard","caboBanner","players","actionTitle","selectionHint","actionArea","timerText","timerBar","resultPanel","roundResults","logList","toggleLogButton","presentationEffects","presentationTrail","presentationAnnouncement","presentationLabel","presentationText"];
const E=Object.fromEntries(ids.map((id)=>[id,$(id)]));
let mode="host",view=null;
let selected=[];
let targetNoticeTimer=null;
let spectatorUi=null;
let presentation=null;
let partitionRenderer=null;
const sessions=createSessionStore({gameId:"cabo"});
const countdown=createCountdown({onTick(value){renderCountdown({textElement:E.timerText,barElement:E.timerBar},value);}});
const room=createAuthoritativeRoomClient({protocolVersion:PROTOCOL_VERSION,sessionStore:sessions,onStatus(status){renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode);},handlers:{onView(next){view=next;const canSelect=next.permissions.canInitialPeek||next.permissions.canExchange;selected=next.roomRole==="spectator"||!canSelect?[]:selected.filter((key)=>findSlot(key));enterRoom();render();presentation?.sync(next.presentationEvents);},onKicked(){spectatorUi?.handleSessionEnded("kicked");},onRoomExpired(){spectatorUi?.handleSessionEnded("room_expired");}}});
spectatorUi=createSpectatorUi({room,getView:()=>view,elements:{joinIntentField:E.joinIntentField,seatActionButton:E.seatActionButton,spectatorSettingButton:E.spectatorSettingButton,spectatorPanel:E.spectatorPanel,spectatorCountBadge:E.spectatorCountBadge,spectatorList:E.spectatorList},notify:(message)=>alert(message),confirmAction:(message)=>confirm(message),onSessionEnded:()=>location.reload()});
const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建失败：${error.message}\n请确认已通过 node game13/signal-server.js 启动服务。`:`加入失败：${error.message}`});

function selectMode(next){mode=next;setModeVisibility(mode,{hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostButton:E.hostModeButton,guestButton:E.guestModeButton});}
function enterRoom(){setHidden(E.setupPanel,true);setHidden(E.roomPanel,false);setHidden(E.roomHeaderTools,false);E.hero.classList.add("in-room");E.roomCodeDisplay.textContent=room.snapshot().roomCode;}
function submit(action){return Promise.resolve(room.submitAction(action)).catch((error)=>{E.connectionStatus.textContent=`操作失败：${error.message}`;alert(error.message);});}
async function createGameRoom(){E.createRoomButton.disabled=true;try{await room.createRoom({name:cleanPlayerName(E.hostNameInput.value,"房主"),capacity:Number(E.playerCountSelect.value)});}catch(error){alert(`创建失败：${error.message}\n请确认已通过 node game13/signal-server.js 启动服务。`);}finally{E.createRoomButton.disabled=false;}}
async function joinGameRoom(){E.joinRoomButton.disabled=true;try{const result=await room.joinRoom({code:E.roomCodeInput.value,name:cleanPlayerName(E.guestNameInput.value,"玩家"),intent:spectatorUi.getJoinIntent()});E.connectionStatus.textContent=spectatorUi.handleJoinResult(result).statusText;}catch(error){alert(`加入失败：${error.message}`);}finally{E.joinRoomButton.disabled=false;}}
async function kickPlayer(playerId){const player=view.players.find((item)=>item.id===playerId);if(!player||player.isHost||!confirm(`确定移出 ${player.name} 吗？进行中的牌局会返回大厅。`))return;try{await room.kick(playerId);}catch(error){alert(error.message);}}
const keyFor=(playerId,slotId)=>`${playerId}:${slotId}`;
function findSlot(key){const [playerId,slotId]=key.split(":");const player=view?.players.find((item)=>item.id===playerId);const slot=player?.slots.find((item)=>item.slotId===slotId);return player&&slot?{player,slot}:null;}
function toggleSlot(playerId,slotId){const key=keyFor(playerId,slotId);selected=selected.includes(key)?selected.filter((item)=>item!==key):[...selected,key];render();}
function powerShort(value){return value===7||value===8?"PEEK":value===9||value===10?"SPY":value===11||value===12?"SWAP":"";}
function ordinaryCardFamily(value){if(value===0)return "zero";if(value>=1&&value<=3)return "low";if(value>=4&&value<=6)return "mid";if(value===13)return "thirteen";return "";}
const POWER_CARD_COPY={PEEK:"秘密查看自己一张背面牌",SPY:"秘密查看对手一张背面牌",SWAP:"交换自己和对手各一张牌"};
function cardAccessibility(value){const power=powerShort(value);return power?`${value}点 · ${power} · ${POWER_CARD_COPY[power]}`:`${value}点`;}
function activeTargetNotice(){return view?.targetNotice&&view.targetNotice.until>serverNow()?view.targetNotice:null;}
function cardHtml(slot,ownerId,interactive=true){const shown=slot.value!==null;const power=shown?powerShort(slot.value):"",family=shown?ordinaryCardFamily(slot.value):"";const notice=activeTargetNotice();const targeted=ownerId===view.selfId&&notice?.targetSlotId===slot.slotId;const targetLabel=notice?.type==="swap"?"被交换":"被查看";const classes=["card","slot-button",!interactive?"read-only":"",shown?"faceup":"back",power?"power":"",family?"ordinary":"",interactive&&selected.includes(keyFor(ownerId,slot.slotId))?"selected":"",slot.temporary?"temporary":"",targeted?"targeted":"",targeted?`targeted-${notice.type}`:""].filter(Boolean).join(" ");const accessibility=shown?cardAccessibility(slot.value):"背面牌";const actionAttributes=interactive?`data-owner="${escapeHtml(ownerId)}" data-slot="${escapeHtml(slot.slotId)}"`:"aria-disabled=\"true\" tabindex=\"-1\"";return `<button type="button" class="${classes}" ${actionAttributes} aria-label="${escapeHtml(accessibility)}" title="${escapeHtml(accessibility)}" data-slot-anchor="${escapeHtml(slot.slotId)}" data-power="${power}" data-card-family="${family}">${shown?`<span>${slot.value}</span>`:"<span>CABO</span>"}${targeted?`<small class="target-marker">${targetLabel}</small>`:""}</button>`;}
function looseCardHtml(card){if(!card)return '<div class="card pile-card empty">空</div>';const label=powerShort(card.value),family=ordinaryCardFamily(card.value),accessibility=cardAccessibility(card.value);return `<div class="card faceup ${label?"power":""} ${family?"ordinary":""}" data-power="${label}" data-card-family="${family}" aria-label="${escapeHtml(accessibility)}" title="${escapeHtml(accessibility)}"><span>${card.value}</span></div>`;}
function seatForPlayer(player,index,memberRole){
  if(memberRole==="spectator")return ({2:["left","right"],3:["left","top","right"],4:["self","left","top","right"]}[view.players.length]||[])[index]||"top";
  if(player.id===view.selfId)return "self";
  const selfIndex=view.players.findIndex((item)=>item.id===view.selfId);
  const offset=(index-selfIndex+view.players.length)%view.players.length;
  if(view.players.length===2)return "top";
  if(view.players.length===3)return offset===1?"left":"right";
  return {1:"left",2:"top",3:"right"}[offset]||"top";
}
function renderPlayers(memberRole){
  const interactive=memberRole!=="spectator";
  const existing=new Map([...E.players.querySelectorAll(":scope > [data-player-id]")].map((element)=>[element.dataset.playerId,element]));
  view.players.forEach((player,index)=>{
    const playerSelection=selected.filter((key)=>key.startsWith(`${player.id}:`));
    const renderKey=JSON.stringify([player.id,player.name,player.isHost,player.connected,player.slots,index,memberRole,view.selfId,view.phase,view.currentPlayerId,view.permissions.canKick,playerSelection,player.id===view.selfId?view.targetNotice:null]);
    let element=existing.get(player.id);
    if(!element){element=document.createElement("article");element.dataset.playerId=player.id;}
    if(element.dataset.renderKey!==renderKey){
      element.dataset.renderKey=renderKey;
      element.className=`player seat-${seatForPlayer(player,index,memberRole)} ${player.id===view.selfId?"self":""} ${player.id===view.currentPlayerId&&!["lobby","roundEnd","ended"].includes(view.phase)?"current":""}`;
      element.innerHTML=`<div class="player-head"><div><b>${escapeHtml(player.name)}</b> ${player.id===view.selfId?"· 你":""}<div class="player-meta">${player.isHost?"房主 · ":""}${player.connected?"在线":"离线"} · ${player.slots.length}张</div></div>${view.permissions.canKick&&!player.isHost?`<button class="kick" data-kick="${escapeHtml(player.id)}">移出</button>`:""}</div><div class="slots">${player.slots.map((slot)=>cardHtml(slot,player.id,interactive)).join("")}</div>`;
      if(interactive)element.querySelectorAll("[data-slot]").forEach((button)=>button.addEventListener("click",()=>toggleSlot(button.dataset.owner,button.dataset.slot)));
      const kick=element.querySelector("[data-kick]");if(kick)kick.addEventListener("click",()=>kickPlayer(kick.dataset.kick));
    }
    const expected=E.players.children[index];if(expected!==element)E.players.insertBefore(element,expected||null);
    existing.delete(player.id);
  });
  existing.forEach((element)=>element.remove());
}
function renderTargetNotice(){if(targetNoticeTimer)clearTimeout(targetNoticeTimer);const notice=activeTargetNotice();setHidden(E.targetNotice,!notice);if(!notice)return;const actor=view.players.find((player)=>player.id===notice.actorId);const me=view.players.find((player)=>player.id===view.selfId);const position=(me?.slots.findIndex((slot)=>slot.slotId===notice.targetSlotId)??-1)+1;const action=notice.type==="swap"?"交换了":"查看了";E.targetNotice.textContent=`${actor?.name||"一名玩家"} ${action}你的第 ${position} 张牌；`;const noticeId=notice.id;targetNoticeTimer=setTimeout(()=>{if(view?.targetNotice?.id!==noticeId)return;setHidden(E.targetNotice,true);E.players.querySelectorAll(".slot-button.targeted").forEach((card)=>{card.classList.remove("targeted","targeted-spy","targeted-swap");card.querySelector(".target-marker")?.remove();});},Math.max(0,notice.until-serverNow()));}
function playerAnchor(id){return id?E.players.querySelector(`[data-player-id="${CSS.escape(String(id))}"]`):null;}
function slotAnchor(playerId,slotId){const seat=playerAnchor(playerId);return seat&&slotId?seat.querySelector(`[data-slot-anchor="${CSS.escape(String(slotId))}"]`):null;}
function presentationLabel(kind){return ({"round-start":"新一轮启程","memory-sealed":"记忆封存","initial-memory":"私人记忆","memory-timeout":"记忆封存","initial-reveal":"月光记忆","turn-start":"轮到行动","draw-deck":"从牌库抽牌","draw-discard":"拿取弃牌","discard-drawn":"弃置抽牌",exchange:"完成换牌","match-success":"匹配成功","match-failed":"匹配失败","failed-placement":"放置新增牌","power-use":"能力发动","private-reveal":"秘密查看","target-notice":"你的牌被操作",swap:"交换牌位","cabo-call":"CABO！","turn-timeout":"回合超时","decision-timeout":"决策超时","round-result":"本轮揭晓"})[kind]||"CABO 动态";}
function eventSource(event){if(event.kind==="draw-deck")return E.drawPile;if(["exchange","match-success","failed-placement"].includes(event.kind))return event.source==="discard"?E.discardPile:E.drawPile;if(event.kind==="draw-discard")return E.discardPile;if(["round-start","initial-reveal","memory-timeout","round-result"].includes(event.kind))return document.querySelector(".piles");return playerAnchor(event.actorId)||document.querySelector(".piles");}
function eventTarget(event){if(["discard-drawn","turn-timeout","decision-timeout","power-use"].includes(event.kind))return E.discardPile;if(event.kind==="cabo-call")return E.caboBanner;if(event.incomingSlotId)return slotAnchor(event.targetPlayerId,event.incomingSlotId);if(["private-reveal","target-notice"].includes(event.kind))return slotAnchor(event.targetPlayerId,event.slotId);if(event.kind==="initial-memory")return slotAnchor(event.targetPlayerId,event.slotIds?.[0]);return playerAnchor(event.targetId||event.actorId)||document.querySelector(".piles");}
function playPresentationObject(event){const source=eventSource(event),target=eventTarget(event);const extraIds=[...(event.slotIds||[]),event.penaltySlotId].filter(Boolean);const extraSlots=extraIds.map((slotId)=>slotAnchor(event.targetPlayerId||event.actorId,slotId)).filter(Boolean);const highlighted=[...new Set([source,target,...extraSlots].filter(Boolean))];highlighted.forEach((element)=>element.classList.add("presentation-focus"));let token=null;if(source&&target&&source!==target){const stage=document.querySelector(".table-stage").getBoundingClientRect(),from=source.getBoundingClientRect(),to=target.getBoundingClientRect();token=document.createElement("span");token.className="presentation-token";token.textContent=({"draw-deck":"牌","draw-discard":event.cardValue,"discard-drawn":event.cardValue,exchange:"换","match-success":"✓","match-failed":"×","failed-placement":event.end==="left"?"←":"→","power-use":String(event.power||"能力").toUpperCase(),"private-reveal":"✦","target-notice":"!",swap:"⇄","cabo-call":"CABO","turn-timeout":"⌛","decision-timeout":"⌛","round-result":"揭"})[event.kind]||"✦";token.style.setProperty("--from-x",`${from.left+from.width/2-stage.left}px`);token.style.setProperty("--from-y",`${from.top+from.height/2-stage.top}px`);token.style.setProperty("--to-x",`${to.left+to.width/2-stage.left}px`);token.style.setProperty("--to-y",`${to.top+to.height/2-stage.top}px`);E.presentationEffects.append(token);}return()=>{highlighted.forEach((element)=>element.classList.remove("presentation-focus"));token?.remove();};}
function addButton(text,action,className=""){
  const button=document.createElement("button");
  button.textContent=text;
  button.className=className;
  button.disabled=!action;
  if(action)button.addEventListener("click",()=>{selected=[];submit(action);});
  E.actionArea.append(button);
}
function selectedParts(){return selected.map(findSlot).filter(Boolean);}
function slotLabel({player,slot}){
  const owner=player.id===view.selfId?"我":player.name;
  return `${owner}的第${player.slots.indexOf(slot)+1}张`;
}
function renderSwapActions(own,other){
  E.actionArea.classList.add("swap-actions");
  const ready=own.length===1 && other.length===1;
  if(ready){
    E.selectionHint.textContent=`交换：${slotLabel(own[0])} ↔ ${slotLabel(other[0])}`;
  }else if(own.length+other.length===1){
    const first=own[0] || other[0];
    E.selectionHint.textContent=`已选：${slotLabel(first)}。再选${own.length?"对手":"自己"}的一张牌即可交换。`;
  }else if(own.length || other.length){
    E.selectionHint.textContent=`已选自己 ${own.length} 张、对手 ${other.length} 张。交换各需一张，点已选牌可取消。`;
  }else{
    E.selectionHint.textContent="交换自己和对手各一张牌；也可只选自己的牌，用抽牌替换或匹配同点牌。";
  }
  addButton("确认 SWAP 交换",ready?{type:"usePower",ownSlotId:own[0].slot.slotId,targetPlayerId:other[0].player.id,targetSlotId:other[0].slot.slotId}:null,"power-action primary");
  const replace=own.length?{type:"exchange",slotIds:own.map(item=>item.slot.slotId)}:null;
  addButton(own.length>1?`匹配自己的 ${own.length} 张牌`:"用抽牌替换我的牌",replace);
  if(view.permissions.canDiscard)addButton("弃掉抽牌",{type:"discardDrawn"});
}
function renderActions(memberRole){E.actionArea.innerHTML="";E.actionArea.classList.remove("swap-actions");E.selectionHint.textContent="";const chosen=selectedParts();
  if(memberRole==="spectator"){E.actionTitle.textContent=view.phase==="lobby"?"等待牌局开始":view.phase==="roundEnd"?"本轮已经结算":view.phase==="ended"?"整局游戏结束":`旁观 ${view.players.find((player)=>player.id===view.currentPlayerId)?.name||"玩家"} 的回合`;E.selectionHint.textContent="旁观视图只显示公共牌面；初始记忆、抽牌、技能查看结果和目标通知均不会发送。";E.actionArea.innerHTML='<p class="spectator-action-note">旁观模式不能选择牌位、抽牌、换牌、发动能力或宣布 CABO。</p>';return;}
  if(view.permissions.canInitialPeek){E.actionTitle.textContent="选择任意两张自己的牌";E.selectionHint.textContent=`已选择 ${chosen.filter((item)=>item.player.id===view.selfId).length}/2 张，确认后等待其他玩家。`;const own=chosen.filter((item)=>item.player.id===view.selfId);if(own.length===2)addButton("确认查看这两张",{type:"initialPeek",slotIds:own.map((item)=>item.slot.slotId)},"primary");return;}
  if(view.phase==="initialPeek"||view.phase==="initialReveal"){E.actionTitle.textContent=view.phase==="initialReveal"?"记住你查看的两张牌":"等待其他玩家选择初始牌";E.selectionHint.textContent="带红色光圈的牌只对你显示；倒计时结束后会重新盖住。";return;}
  if(view.permissions.canCloseReveal){E.actionTitle.textContent="记住这张牌";E.selectionHint.textContent="这是仅发送给你的临时私密视图。";addButton("提前盖回并结束回合",{type:"closeReveal"},"primary");return;}
  if(view.permissions.canDraw){E.actionTitle.textContent="轮到你行动";addButton("从牌库抽一张",{type:"drawDeck"},"primary");if(view.discardTop)addButton(`拿取弃牌 ${view.discardTop.value}`,{type:"drawDiscard"});if(view.permissions.canCallCabo)addButton("宣布 CABO",{type:"callCabo"},"cabo");return;}
  if(view.permissions.canPlaceFailedExchange){E.actionTitle.textContent="多牌匹配失败";E.selectionHint.textContent=`所选牌已经公开。请决定把抽到的 ${view.pendingCard.value} 放在手牌最左侧还是最右侧。`;addButton("放在最左侧",{type:"placeFailedExchange",end:"left"},"primary");addButton("放在最右侧",{type:"placeFailedExchange",end:"right"});return;}
  if(view.permissions.canExchange){
    E.actionTitle.textContent=`处理抽到的 ${view.pendingCard.value}`;
    const own=chosen.filter(item=>item.player.id===view.selfId);
    const power=view.permissions.canUsePower && view.pendingCard.power;
    if(power==="swap"){
      renderSwapActions(own,chosen.filter(item=>item.player.id!==view.selfId));
      return;
    }
    E.selectionHint.textContent="选择自己的一张牌替换；选择多张时必须数值相同，匹配成功后新牌固定放在所选牌中最靠左的位置。";
    if(own.length===1)addButton("确认替换所选牌",{type:"exchange",slotIds:own.map(item=>item.slot.slotId)},"primary");
    if(own.length>1)addButton(`确认匹配 ${own.length} 张 · 新牌放最左选位`,{type:"exchange",slotIds:own.map(item=>item.slot.slotId)},"primary");
    if(view.permissions.canDiscard)addButton("直接弃掉，不发动能力",{type:"discardDrawn"});
    if(power==="peek"){
      const backs=own.filter(item=>!item.slot.faceUp);
      if(backs.length===1)addButton("发动PEEK查看所选牌",{type:"usePower",slotId:backs[0].slot.slotId},"power-action");
      E.selectionHint.textContent+=" PEEK需要选择自己一张背面牌。";
    }else if(power==="spy"){
      const targets=chosen.filter(item=>item.player.id!==view.selfId&&!item.slot.faceUp);
      if(targets.length===1)addButton("发动SPY查看所选对手牌",{type:"usePower",targetPlayerId:targets[0].player.id,slotId:targets[0].slot.slotId},"power-action");
      E.selectionHint.textContent+=" SPY需要选择对手一张背面牌。";
    }
    return;}
  if(view.phase==="roundEnd"){E.actionTitle.textContent="本轮已经结算";return;}if(view.phase==="ended"){E.actionTitle.textContent="整局游戏结束";return;}E.actionTitle.textContent=view.currentPlayerId?`等待 ${view.players.find((player)=>player.id===view.currentPlayerId)?.name} 行动`:"等待房主开始";
}
function renderScore(){E.scoreboard.innerHTML=view.players.map((player)=>`<div class="score-row"><span>${escapeHtml(player.name)}${player.resetUsed?" <small>已用100→50</small>":""}</span><b>${player.score}</b></div>`).join("");}
function renderResult(){const visible=view.roundResult.length>0;setHidden(E.resultPanel,!visible);if(!visible)return;E.roundResults.innerHTML=view.roundResult.map((item)=>{const player=view.players.find((entry)=>entry.id===item.playerId);const reason={caboSuccess:"CABO成功",caboPenalty:"CABO失败+10",kamikaze:"Kamikaze",kamikazePenalty:"Kamikaze惩罚",cards:"牌面"}[item.reason];return `<div class="result-row"><b>${escapeHtml(player?.name||"玩家")}</b><span>${reason}：+${item.score}${item.resetApplied?"，总分重置为50":""}</span><strong>累计 ${item.totalScore}</strong></div>`;}).join("");}
function phaseText(){return {lobby:"大厅",initialPeek:"选择初始牌",initialReveal:"私密记忆",turn:"行动阶段",drawn:"处理抽牌",failedExchange:"放置新增牌",reveal:"私密查看",roundEnd:"本轮结束",ended:"游戏结束"}[view.phase]||view.phase;}
function renderRoom(model){setHidden(E.hostTools,!view.permissions.canManage);setHidden(E.startGameButton,!view.permissions.canStart);setHidden(E.endGameButton,!view.permissions.canEnd);E.startGameButton.textContent=view.phase==="roundEnd"?"开始下一轮":"开始游戏";E.startGameButton.disabled=(view.phase==="lobby"&&view.players.length!==view.capacity)||view.players.some((player)=>!player.connected);E.roomPlayerCountSelect.value=String(view.capacity);E.roomPlayerCountSelect.disabled=!view.permissions.canSetCapacity;E.roomCodeDisplay.textContent=model.roomCode;}
function renderStatus(model){E.roundNumber.textContent=view.round;E.phaseLabel.textContent=phaseText();E.notice.textContent=view.phase==="lobby"?(model.isSpectator?"你正在旁观准备阶段，可在有空位时进入玩家席。":`等待玩家加入：${view.players.length}/${view.capacity}`):view.phase==="ended"?`胜者：${view.winnerIds.map((id)=>view.players.find((player)=>player.id===id)?.name).join("、")}`:model.current?`${model.isSpectator?"正在旁观 · ":""}当前行动：${model.current.name}`:"牌局已结算";}
function renderTable(){E.deckCount.textContent=view.deckCount;E.discardCount.textContent=view.discardCount;E.discardPile.className=view.discardTop?"card pile-card faceup":"card pile-card empty";E.discardPile.innerHTML=view.discardTop?`<span>${view.discardTop.value}</span>`:"空";E.discardPile.dataset.power=view.discardTop?powerShort(view.discardTop.value):"";E.discardPile.classList.toggle("power",Boolean(E.discardPile.dataset.power));const discardFamily=view.discardTop?ordinaryCardFamily(view.discardTop.value):"";E.discardPile.dataset.cardFamily=discardFamily;E.discardPile.classList.toggle("ordinary",Boolean(discardFamily));const discardAccessibility=view.discardTop?cardAccessibility(view.discardTop.value):"空弃牌堆";E.discardPile.setAttribute("aria-label",discardAccessibility);E.discardPile.title=discardAccessibility;setHidden(E.pendingWrap,!view.pendingCard);if(view.pendingCard)E.pendingCard.innerHTML=looseCardHtml(view.pendingCard);setHidden(E.caboBanner,!view.cabo);if(view.cabo)E.caboBanner.textContent=`${view.players.find((player)=>player.id===view.cabo.callerId)?.name} 已宣布 CABO · 最终回合剩余 ${view.cabo.remainingIds.length} 人`;E.drawPile.disabled=!view.permissions.canDraw;E.drawPile.onclick=view.permissions.canDraw?()=>submit({type:"drawDeck"}):null;}
function renderDecision(model){renderActions(model.memberRole);}
function renderLog(){E.logList.innerHTML=view.logs.map((entry)=>`<div class="log-item">${escapeHtml(entry.text)}</div>`).join("");}
function renderTimer(){if(view.deadline)countdown.start(view.deadline,Math.max(ACTION_SECONDS*1000,view.deadline-serverNow()));else{countdown.stop();E.timerText.textContent="--";E.timerBar.style.width="0";}}
partitionRenderer=createGame13PartitionRenderer({room:renderRoom,status:renderStatus,table:renderTable,players:(model)=>renderPlayers(model.memberRole),targetNotice:renderTargetNotice,score:renderScore,decision:renderDecision,result:renderResult,log:renderLog,countdown:renderTimer});
function render(){if(!view)return;const spectatorModel=spectatorUi.render(view),memberRole=spectatorModel.memberRole;if(memberRole==="spectator")selected=[];partitionRenderer.render(createGame13RenderModel(view,{memberRole,roomCode:room.snapshot().roomCode,selected}));}
function endGame(){if(confirm("确定结束当前游戏并清空牌局进度吗？"))submit({type:"end"});}
async function init(){roomEntry.bind();spectatorUi.bind();E.roomPlayerCountSelect.addEventListener("change",()=>submit({type:"setCapacity",capacity:Number(E.roomPlayerCountSelect.value)}));E.startGameButton.addEventListener("click",()=>submit({type:"start"}));E.endGameButton.addEventListener("click",endGame);E.toggleLogButton.addEventListener("click",()=>{const collapsed=E.logList.classList.toggle("collapsed");E.toggleLogButton.textContent=collapsed?"展开":"收起";});try{spectatorUi.applyConfig(await room.checkServer());}catch{/* create/join will show details */}}
presentation=createPresentationTimeline({container:document.querySelector(".table-stage"),trailPath:E.presentationTrail,announcement:E.presentationAnnouncement,labelElement:E.presentationLabel,textElement:E.presentationText,effectsElement:E.presentationEffects,resolveSource:eventSource,resolveTarget:eventTarget,labelFor:(event)=>presentationLabel(event.kind),beforePlay:playPresentationObject,durationMs:1350,reducedDurationMs:540,maxQueue:18,sceneKey:(event)=>event.sceneId||event.id,priorityFor:(event)=>Number(event.priority)||0,catchUpThreshold:2,severeBacklogThreshold:5,catchUpDurationMs:620,severeDurationMs:320,urgentPriority:4,retainPriority:3});
init();
