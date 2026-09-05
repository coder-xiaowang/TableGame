"use strict";

import {
  bindRoomCodeInput, cleanPlayerName, createAuthoritativeRoomClient, createCountdown,
  createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus,
  renderCountdown, setHidden, setModeVisibility
} from "/shared/client/index.js";

const PROTOCOL_VERSION = 3;
const PHASE_MS = { turnStart: 20000, draw: 20000, drawChoice: 20000, kitChoice: 20000, judgmentChoice: 20000, play: 75000, defense: 15000, duel: 12000, dying: 15000, discardExcess: 25000, generalStore: 20000 };
const SUIT = { spades: "♠", hearts: "♥", clubs: "♣", diamonds: "♦" };
const CARD = {
  bang:["砰！","对射程内一名玩家开枪"],missed:["闪！","躲避砰！"],beer:["啤酒","回复1点生命"],cat_balou:["拆除","弃掉目标一张牌"],stagecoach:["驿马车","摸2张牌"],duel:["决斗","轮流打出砰！"],general_store:["杂货店","所有人依次选牌"],gatling:["加特林","攻击其他所有玩家"],indians:["印第安人！","其他玩家打出砰！"],panic:["抢劫","取得距离1玩家的一张牌"],saloon:["酒馆","所有玩家回复1点"],wells_fargo:["富国银行","摸3张牌"],barrel:["木桶","红桃判定躲避砰！"],dynamite:["炸药","黑桃2至9爆炸"],scope:["瞄准镜","攻击距离-1"],mustang:["野马","被攻击距离+1"],jail:["监狱","非红桃跳过回合"],volcanic:["火山手枪","射程1，可连续砰！"],schofield:["斯科菲尔德","射程2"],remington:["雷明顿","射程3"],rev_carabine:["卡宾枪","射程4"],winchester:["温彻斯特","射程5"]
};
const ROLE = { sheriff:"警长", deputy:"副警长", outlaw:"歹徒", renegade:"叛徒" };
const $ = (id) => document.getElementById(id);
const E = Object.fromEntries(["hero","connectionStatus","roomHeaderTools","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField","roomCodeDisplay","hostTools","roomPlayerCountSelect","spectatorSettingButton","seatActionButton","spectatorPanel","spectatorCountBadge","spectatorList","startGameButton","restartGameButton","endGameButton","notice","players","centerMoment","deckCount","discardTop","controlDock","actionTitle","actionHint","actionButtons","timerText","timerBar","privateZone","selfSummary","myHand","toggleLogButton","logList"].map((id)=>[id,$(id)]));

let view = null, selectedCardId = null, selectedTargetId = null, spectatorUi = null;
const sessions = createSessionStore({ gameId:"bang" });
const countdown = createCountdown({ onTick(value){ renderCountdown({ textElement:E.timerText,barElement:E.timerBar },value); } });
const room = createAuthoritativeRoomClient({
  protocolVersion:PROTOCOL_VERSION, sessionStore:sessions,
  onStatus(status){ renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode); },
  handlers:{ onView(next){ view=next; const mine=own()?.hand.some((card)=>card.id===selectedCardId); if(!mine){selectedCardId=null;selectedTargetId=null;} enterRoom();render(); }, onKicked(){spectatorUi?.handleSessionEnded("kicked");}, onRoomExpired(){spectatorUi?.handleSessionEnded("room_expired");} }
});
spectatorUi=createSpectatorUi({room,getView:()=>view,elements:{joinIntentField:E.joinIntentField,seatActionButton:E.seatActionButton,spectatorSettingButton:E.spectatorSettingButton,spectatorPanel:E.spectatorPanel,spectatorCountBadge:E.spectatorCountBadge,spectatorList:E.spectatorList},notify:(m)=>alert(m),confirmAction:(m)=>confirm(m),onSessionEnded:()=>location.reload()});

function own(){return view?.players.find((player)=>player.id===view.selfId)||null;}
function player(id){return view?.players.find((item)=>item.id===id)||null;}
function name(id){return player(id)?.name||"玩家";}
function submit(action){const bound=view?.pending?.id?{...action,effectId:view.pending.id}:action;return Promise.resolve(room.submitAction(bound)).catch((error)=>{alert(error.message);});}
function enterRoom(){setHidden(E.setupPanel,true);setHidden(E.roomPanel,false);setHidden(E.roomHeaderTools,false);E.hero.classList.add("in-room");E.roomCodeDisplay.textContent=room.snapshot().roomCode;}
function cardName(type){return CARD[type]?.[0]||"未知牌";}
function cardHtml(card,{selectable=false,selected=false}={}){
  if(!card?.type)return '<div class="card"><b>秘密手牌</b><small>仅持有者可见</small></div>';
  const red=["hearts","diamonds"].includes(card.suit);
  return `<button class="card ${CARD[card.type]&&["barrel","dynamite","scope","mustang","jail","volcanic","schofield","remington","rev_carabine","winchester"].includes(card.type)?"blue":""} ${selected?"selected":""}" ${selectable?`data-card="${escapeHtml(card.id)}"`:"disabled"}><span class="symbol ${red?"red-suit":""}">${escapeHtml(card.rank||"")}${SUIT[card.suit]||""}</span><b>${escapeHtml(cardName(card.type))}</b><small>${escapeHtml(CARD[card.type]?.[1]||"")}</small></button>`;
}
function addButton(label,handler,kind=""){const button=document.createElement("button");button.textContent=label;button.className=kind;button.onclick=handler;E.actionButtons.append(button);return button;}
function renderPlayers(){
  const selfIndex=view.players.findIndex((p)=>p.id===view.selfId);
  const seats=selfIndex<0?view.players:[...view.players.slice(selfIndex),...view.players.slice(0,selfIndex)];
  E.players.dataset.count=String(seats.length);
  E.players.innerHTML=seats.map((p)=>`<article class="player-seat ${p.id===view.selfId?"self":""} ${p.id===view.currentPlayerId?"current":""} ${!p.alive?"dead":""} ${!p.connected?"offline":""}"><div class="seat-head"><div><b>${escapeHtml(p.name)}${p.id===view.selfId?" · 你":""}</b><small>${p.connected?"在线":"离线"} · ${p.handCount}张手牌${p.distance?` · 距离${p.distance}`:""}</small></div><span class="role">${escapeHtml(p.role?ROLE[p.role]:"身份隐藏")}</span></div><div class="character">${escapeHtml(p.characterName||"等待角色")} <span class="life">${p.alive?"♥".repeat(Math.max(0,p.life)):"已出局"}${p.maxLife?` / ${p.maxLife}`:""}</span></div><div class="equipment">${p.equipment.map((card)=>`<span class="equip">${escapeHtml(cardName(card.type))}</span>`).join("")||"<small>无装备</small>"}</div></article>`).join("");
}
function targetButtons(card){
  const self=own(), type=card.type;
  if(type==="missed"&&self?.characterId!=="calamity_janet"){E.actionHint.textContent="【闪！】通常只能在受到【砰！】时响应，不能主动打出。";return;}
  const needsTarget=["bang","missed","duel","panic","cat_balou","jail"].includes(type);
  if(!needsTarget)return addButton(`使用${cardName(type)}`,()=>submit({type:"playCard",cardId:card.id}),"primary");
  const targets=view.players.filter((p)=>p.alive&&p.id!==view.selfId&&(!(type==="bang"||type==="missed")||p.distance<=weaponRange(self))&&(!(type==="panic")||p.distance<=1)&&(type!=="jail"||p.role!=="sheriff"));
  if(!selectedTargetId){E.actionHint.textContent="请选择目标；服务器会再次校验距离与规则。";for(const p of targets)addButton(`${p.name}${p.distance?` · 距离${p.distance}`:""}`,()=>{selectedTargetId=p.id;renderActions();});return;}
  const target=player(selectedTargetId);
  if(["panic","cat_balou"].includes(type)){
    if(target?.handCount)addButton(`随机选择 ${target.name} 的一张手牌`,()=>submit({type:"playCard",cardId:card.id,targetId:selectedTargetId,targetZone:"hand"}),"primary");
    for(const item of target?.equipment||[])addButton(`${cardName(item.type)}`,()=>submit({type:"playCard",cardId:card.id,targetId:selectedTargetId,targetCardId:item.id}));
  }else addButton(`确认对 ${target?.name} 使用`,()=>submit({type:"playCard",cardId:card.id,targetId:selectedTargetId}),"primary");
  addButton("重选目标",()=>{selectedTargetId=null;renderActions();});
}
function weaponRange(self){const weapon=self?.equipment.find((c)=>["volcanic","schofield","remington","rev_carabine","winchester"].includes(c.type));return {volcanic:1,schofield:2,remington:3,rev_carabine:4,winchester:5}[weapon?.type]||1;}
function responseCards(expected){return own()?.hand.filter((card)=>card.type===expected||(own().characterId==="calamity_janet"&&((expected==="missed"&&card.type==="bang")||(expected==="bang"&&card.type==="missed"))))||[];}
function renderActions(){
  if(!view)return;E.actionButtons.innerHTML="";E.actionHint.textContent="";const role=spectatorUi.render(view).memberRole;
  if(role==="spectator"){E.actionTitle.textContent=view.phase==="lobby"?"旁观准备阶段":"正在旁观枪战";E.actionHint.textContent="隐藏身份和手牌不会发送给旁观者。";return;}
  if(view.phase==="lobby"){E.actionTitle.textContent="等待枪手到齐";E.actionHint.textContent=`当前 ${view.players.length}/${view.capacity} 人。`;return;}
  if(view.phase==="ended"){E.actionTitle.textContent=view.winner?.text||"枪战结束";E.actionHint.textContent="所有身份与手牌已经公开。";return;}
  if(view.permissions.canDraw){E.actionTitle.textContent="摸牌阶段";addButton("从牌库摸2张",()=>submit({type:"draw"}),"primary");return;}
  if(view.permissions.canChooseDraw){E.actionTitle.textContent="选择摸牌方式";addButton("正常摸2张",()=>submit({type:"chooseDraw",mode:"deck"}),"primary");if(own().characterId==="pedro_ramirez"&&view.discardTop)addButton("取得弃牌顶 + 摸1张",()=>submit({type:"chooseDraw",mode:"discard"}));if(own().characterId==="jesse_jones")for(const p of view.players.filter((p)=>p.alive&&p.id!==view.selfId&&p.handCount))addButton(`从${p.name}随机抽1张`,()=>submit({type:"chooseDraw",mode:"steal",targetId:p.id}));return;}
  if(view.permissions.canChooseKit){E.actionTitle.textContent="基特·卡尔森：从三张中选两张";const picked=new Set();for(const card of view.pending.cards){const b=addButton(`${card.rank}${SUIT[card.suit]} ${cardName(card.type)}`,()=>{picked.has(card.id)?picked.delete(card.id):picked.add(card.id);b.classList.toggle("primary",picked.has(card.id));confirm.disabled=picked.size!==2;});}const confirm=addButton("确认选择",()=>submit({type:"chooseKit",cardIds:[...picked]}),"primary");confirm.disabled=true;return;}
  if(view.permissions.canChooseJudgment){E.actionTitle.textContent=`幸运公爵：选择${view.pending.purpose==="dynamite"?"炸药":view.pending.purpose==="jail"?"监狱":"木桶"}判定`;for(const card of view.pending.cards)addButton(`${card.rank}${SUIT[card.suit]} · ${cardName(card.type)}`,()=>submit({type:"chooseJudgment",cardId:card.id}),"primary");return;}
  if(view.permissions.canPlay){const card=own()?.hand.find((item)=>item.id===selectedCardId);E.actionTitle.textContent=card?`准备使用：${cardName(card.type)}`:"轮到你行动";E.actionHint.textContent=card?CARD[card.type]?.[1]:"点击下方手牌选择，或直接结束回合。";if(card)targetButtons(card);addButton("结束回合",()=>submit({type:"endTurn"}),"danger");renderSid();return;}
  if(view.phase==="defense"&&view.pending?.actorId===view.selfId){const expected=view.pending.sourceType==="indians"?"bang":"missed";E.actionTitle.textContent=view.pending.sourceType==="indians"?"印第安人来袭":"枪声逼近";for(const card of responseCards(expected))addButton(`打出${cardName(card.type)}`,()=>submit({type:"respond",cardId:card.id}),"primary");if(view.pending.sourceType==="bang"&&(own().characterId==="jourdonnais"||own().equipment.some((c)=>c.type==="barrel")))addButton("尝试木桶判定",()=>submit({type:"useBarrel"}));addButton("承受伤害",()=>submit({type:"takeHit"}),"danger");return;}
  if(view.phase==="duel"&&view.pending?.actorId===view.selfId){E.actionTitle.textContent="决斗：打出一张【砰！】";for(const card of responseCards("bang"))addButton(`打出${cardName(card.type)}`,()=>submit({type:"respond",cardId:card.id}),"primary");addButton("认输并受伤",()=>submit({type:"takeHit"}),"danger");return;}
  if(view.phase==="dying"){E.actionTitle.textContent=`${name(view.pending.actorId)} 濒死，需要啤酒`;for(const card of own().hand.filter((c)=>c.type==="beer"))addButton(`用啤酒救援`,()=>submit({type:"useBeer",cardId:card.id}),"primary");if(view.permissions.canResolveOwnDying){renderSid();addButton("放弃救援",()=>submit({type:"giveUp"}),"danger");}return;}
  if(view.permissions.canDiscard){E.actionTitle.textContent=`手牌超限：弃掉${view.pending.count}张`;const picked=new Set();for(const card of own().hand){const b=addButton(cardName(card.type),()=>{picked.has(card.id)?picked.delete(card.id):picked.add(card.id);b.classList.toggle("primary",picked.has(card.id));confirm.disabled=picked.size!==view.pending.count;});}const confirm=addButton("确认弃牌",()=>submit({type:"discardCards",cardIds:[...picked]}),"danger");confirm.disabled=true;return;}
  if(view.permissions.canOrderEliminationDiscard){E.actionTitle.textContent="出局：安排弃牌顺序";E.actionHint.textContent="依次点击全部手牌与装备；最后点击的牌会成为弃牌堆顶。";const cards=[...own().hand,...own().equipment],ordered=[];for(const card of cards){const button=addButton(cardName(card.type),()=>{if(ordered.includes(card.id))return;ordered.push(card.id);button.disabled=true;button.textContent=`${ordered.length}. ${cardName(card.type)}`;confirm.disabled=ordered.length!==cards.length;});}const confirm=addButton("确认全部弃牌",()=>submit({type:"orderEliminationDiscard",cardIds:ordered}),"danger");confirm.disabled=true;return;}
  if(view.permissions.canChooseStore){E.actionTitle.textContent="杂货店：选择一张公开牌";for(const card of view.pending.choices)addButton(`${card.rank}${SUIT[card.suit]} ${cardName(card.type)}`,()=>submit({type:"chooseStore",cardId:card.id}),"primary");return;}
  E.actionTitle.textContent=`等待 ${name(view.pending?.actorId||view.currentPlayerId)} 操作`;E.actionHint.textContent="服务器将在倒计时结束后执行合法默认动作。";renderSid();
}
function renderSid(){if(own()?.characterId!=="sid_ketchum"||own().hand.length<2)return;addButton("西德：弃2张牌回血",()=>{const cards=own().hand;const answer=prompt(`输入要弃掉的两张牌序号（例如 1,3）：\n${cards.map((card,index)=>`${index+1}. ${cardName(card.type)} ${card.rank}${SUIT[card.suit]}`).join("\n")}`);if(answer==null)return;const indexes=answer.split(/[,，\s]+/).filter(Boolean).map((value)=>Number(value)-1);if(indexes.length!==2||new Set(indexes).size!==2||indexes.some((index)=>!cards[index]))return alert("请输入两个不同且有效的牌序号。");submit({type:"useSid",cardIds:indexes.map((index)=>cards[index].id)});});}
function renderHand(role){setHidden(E.privateZone,role==="spectator");if(role==="spectator")return;const self=own();E.selfSummary.textContent=self?`${self.characterName||"未分配角色"} · ${self.role?ROLE[self.role]:""} · ${self.life}/${self.maxLife}生命`:"";E.myHand.innerHTML=self?.hand.map((card)=>cardHtml(card,{selectable:view.permissions.canPlay,selected:card.id===selectedCardId})).join("")||'<p class="muted">暂无手牌</p>';E.myHand.querySelectorAll("[data-card]").forEach((button)=>button.onclick=()=>{selectedCardId=button.dataset.card;selectedTargetId=null;renderHand(role);renderActions();});}
function render(){const model=spectatorUi.render(view),role=model.memberRole;setHidden(E.hostTools,!view.permissions.canManage);setHidden(E.startGameButton,!view.permissions.canStart);setHidden(E.restartGameButton,!view.permissions.canRestart);setHidden(E.endGameButton,!view.permissions.canEnd);E.startGameButton.disabled=view.players.length!==view.capacity||view.players.some((p)=>!p.connected);E.roomPlayerCountSelect.value=String(view.capacity);E.roomPlayerCountSelect.disabled=!view.permissions.canSetCapacity;E.notice.textContent=view.phase==="lobby"?`等待玩家：${view.players.length}/${view.capacity}`:`第 ${view.turn} 回合 · ${name(view.currentPlayerId)} 行动`;E.centerMoment.textContent=view.winner?.text||(view.phase==="lobby"?"酒馆尚未响起枪声":view.logs[0]?.text||`${name(view.currentPlayerId)} 的回合`);E.deckCount.textContent=view.deckCount;E.discardTop.innerHTML=view.discardTop?`<b>${escapeHtml(cardName(view.discardTop.type))}</b><span>${escapeHtml(view.discardTop.rank+SUIT[view.discardTop.suit])}</span>`:"<b>—</b><span>弃牌堆</span>";renderPlayers();renderActions();renderHand(role);E.logList.innerHTML=view.logs.map((item)=>`<div class="log-item">${escapeHtml(item.text)}</div>`).join("")||'<p class="muted">暂无记录</p>';if(view.deadline)countdown.start(view.deadline,PHASE_MS[view.phase]||20000);else{countdown.stop();E.timerText.textContent="--";E.timerBar.style.width="0";}}
async function createRoom(){E.createRoomButton.disabled=true;try{await room.createRoom({name:cleanPlayerName(E.hostNameInput.value,"房主"),capacity:Number(E.playerCountSelect.value)});}catch(error){alert(`创建失败：${error.message}\n请确认已启动 game19 服务。`);}finally{E.createRoomButton.disabled=false;}}
async function joinRoom(){E.joinRoomButton.disabled=true;try{const result=await room.joinRoom({code:E.roomCodeInput.value,name:cleanPlayerName(E.guestNameInput.value,"玩家"),intent:spectatorUi.getJoinIntent()});E.connectionStatus.textContent=spectatorUi.handleJoinResult(result).statusText;}catch(error){alert(`加入失败：${error.message}`);}finally{E.joinRoomButton.disabled=false;}}
function init(){bindRoomCodeInput(E.roomCodeInput);E.hostModeButton.onclick=()=>setModeVisibility("host",{hostButton:E.hostModeButton,guestButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools});E.guestModeButton.onclick=()=>setModeVisibility("guest",{hostButton:E.hostModeButton,guestButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools});E.createRoomButton.onclick=createRoom;E.joinRoomButton.onclick=joinRoom;spectatorUi.bind();E.roomPlayerCountSelect.onchange=()=>submit({type:"setCapacity",capacity:Number(E.roomPlayerCountSelect.value)});E.startGameButton.onclick=()=>submit({type:"start"});E.restartGameButton.onclick=()=>submit({type:"restart"});E.endGameButton.onclick=()=>confirm("确定结束牌局吗？")&&submit({type:"end"});E.toggleLogButton.onclick=()=>{const hidden=E.logList.classList.toggle("collapsed");E.toggleLogButton.textContent=hidden?"展开":"收起";};room.checkServer().then((config)=>spectatorUi.applyConfig(config)).catch(()=>{});}
init();
