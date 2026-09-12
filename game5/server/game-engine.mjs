import {
  ACTION_SECONDS, COLORS, INITIAL_HAND_SIZE, MAX_PLAYERS, MIN_PLAYERS,
  createDeck, describeCard, isDrawCard, isPlayable, shuffle
} from "../rules.mjs";
import { appendPresentationEvent, normalizePresentationState, validatePresentationState } from "../../shared/server/presentation-events.mjs";

export { ACTION_SECONDS };
export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;

export class GameRuleError extends Error {
  constructor(code,message,status=400) {
    super(message); this.name="GameRuleError"; this.code=code; this.status=status;
  }
}

function cleanName(value,fallback="玩家") { return String(value??"").trim().slice(0,12)||fallback; }
function assertCapacity(value) {
  const capacity=Number(value);
  if (!Number.isInteger(capacity)||capacity<MIN_PLAYERS||capacity>MAX_PLAYERS) throw new GameRuleError("invalid_capacity","游戏人数必须为 2～6 人。");
  return capacity;
}
function makePlayer({id,name,isHost=false,connected=false}) {
  if (!id) throw new GameRuleError("player_id_required","缺少玩家身份。");
  return {id:String(id),name:cleanName(name,isHost?"房主":"玩家"),isHost:Boolean(isHost),connected:Boolean(connected),hand:[],unoCalled:false};
}
function playerById(state,id) { return state.players.find((player)=>player.id===String(id))||null; }
function requireActor(state,id) {
  const actor=playerById(state,id);
  if (!actor) throw new GameRuleError("not_a_player","你不属于这个房间。",403);
  return actor;
}
function requireHost(state,id) {
  const actor=requireActor(state,id);
  if (!actor.isHost) throw new GameRuleError("host_required","只有房主可以执行此操作。",403);
  return actor;
}
function currentPlayer(state) { return state.players[state.currentIndex]||null; }
function nextIndex(state,from,steps=1) {
  let index=from;
  for (let count=0;count<steps;count+=1) index=(index+state.direction+state.players.length)%state.players.length;
  return index;
}
function addLog(state,text,now) {
  state.logs.unshift({id:`log_${state.logSequence+=1}`,text,at:now});
  if (state.logs.length>80) state.logs.length=80;
}
function publicEvent(state,event,now) {
  return appendPresentationEvent(state,event,{
    now,eventsKey:"presentationEvents",sequenceKey:"presentationSequence",idPrefix:"uno_event",limit:60
  });
}
function privateEvent(state,playerId,event,now) {
  const id=String(playerId||"");
  if (!id) return null;
  if (!state.privatePresentationEvents||typeof state.privatePresentationEvents!=="object") state.privatePresentationEvents={};
  const envelope={events:Array.isArray(state.privatePresentationEvents[id])?state.privatePresentationEvents[id]:[],sequence:Number(state.presentationSequence)||0};
  const stored=appendPresentationEvent(envelope,{...event,private:true},{
    now,eventsKey:"events",sequenceKey:"sequence",idPrefix:"uno_private",limit:30
  });
  state.privatePresentationEvents[id]=envelope.events;
  state.presentationSequence=envelope.sequence;
  return stored;
}
function publicCard(card) {
  return card?{id:card.id,color:card.color,type:card.type,value:card.value}:null;
}
function privateDrawEvent(state,player,cards,reason,now) {
  if (!cards.length) return;
  privateEvent(state,player.id,{
    kind:"private-draw",actorId:player.id,reason,cards:cards.map(publicCard),count:cards.length,
    text:`你摸到了 ${cards.map(describeCard).join("、")}`
  },now);
}
function resetToLobby(state) {
  state.phase="lobby"; state.deck=[]; state.discard=[]; state.currentColor=null; state.currentIndex=0; state.direction=1;
  state.pendingDraw=0; state.pendingWild=null; state.pendingWinnerId=null; state.drawnCardId=null;
  state.unoVulnerableId=null; state.winnerId=null; state.deadline=0; state.logs=[]; state.logSequence=0;
  state.presentationEvents=[]; state.privatePresentationEvents={};
  for (const player of state.players) { player.hand=[]; player.unoCalled=false; }
}
function topCard(state) { return state.discard.at(-1)||null; }
function playable(state,card) {
  return isPlayable(card,{top:topCard(state),currentColor:state.currentColor,pendingDraw:state.pendingDraw,drawnCardId:state.drawnCardId});
}
function recycle(state,random,now) {
  if (state.discard.length<=1) throw new GameRuleError("deck_exhausted","牌堆和弃牌堆均没有足够卡牌。",409);
  const top=state.discard.pop();
  state.deck=shuffle(state.discard,random);
  state.discard=[top];
  publicEvent(state,{kind:"deck-recycled",text:"弃牌堆重新洗成摸牌堆"},now);
  addLog(state,"弃牌堆已重新洗成摸牌堆",now);
}
function drawRaw(state,random,now) {
  if (!state.deck.length) recycle(state,random,now);
  return state.deck.pop();
}
function drawMany(state,player,count,random,now) {
  const cards=[];
  for (let index=0;index<count;index+=1) { const card=drawRaw(state,random,now); player.hand.push(card); cards.push(card); }
  return cards;
}
function expireUno(state,now) {
  if (!state.unoVulnerableId) return;
  state.unoVulnerableId=null;
  addLog(state,"抓 UNO 的时机已经结束",now);
}
function beginTurn(state,now) {
  if (state.phase!=="playing") return;
  state.drawnCardId=null;
  state.players.forEach((player,index)=>{if(index!==state.currentIndex) player.unoCalled=false;});
  state.deadline=now+ACTION_SECONDS*1000;
  const player=currentPlayer(state);
  publicEvent(state,{kind:"turn-start",actorId:player?.id||null,pendingDraw:state.pendingDraw,challengeAllowed:Boolean(state.pendingWild),text:`轮到 ${player?.name||"玩家"} 行动`},now);
}
function clearPenalty(state) {
  state.pendingDraw=0; state.pendingWild=null; state.pendingWinnerId=null;
}
function finish(state,playerId,now) {
  state.phase="ended"; state.winnerId=playerId; state.pendingWinnerId=null; state.deadline=0;
  state.drawnCardId=null; state.unoVulnerableId=null;
  publicEvent(state,{kind:"game-won",actorId:playerId,text:`${playerById(state,playerId)?.name||"玩家"} 打完手牌，获得胜利`},now);
  addLog(state,`${playerById(state,playerId)?.name||"玩家"} 打完所有手牌，获得胜利！`,now);
}
function advance(state,now) {
  state.currentIndex=nextIndex(state,state.currentIndex);
  beginTurn(state,now);
}
function acceptPenalty(state,player,{now,random,reason="接受罚牌"}) {
  if (state.pendingDraw<=0) throw new GameRuleError("no_pending_penalty","当前没有需要接受的罚牌。",409);
  expireUno(state,now);
  const count=state.pendingDraw;
  const cards=drawMany(state,player,count,random,now);
  publicEvent(state,{kind:"penalty-accepted",actorId:player.id,targetId:player.id,count,reason,text:`${player.name} 接受并摸取 ${count} 张罚牌`},now);
  privateDrawEvent(state,player,cards,"penalty",now);
  addLog(state,reason==="超时"?`${player.name} 超时，摸取 ${count} 张罚牌`:`${player.name} 接受罚牌，摸了 ${count} 张`,now);
  const pendingWinnerId=state.pendingWinnerId;
  clearPenalty(state);
  if (pendingWinnerId) finish(state,pendingWinnerId,now); else advance(state,now);
}
function playCard(state,player,cardId,chosenColor,{now,random}) {
  const index=player.hand.findIndex((card)=>card.id===String(cardId));
  const card=player.hand[index];
  if (!card) throw new GameRuleError("card_not_in_hand","所选牌不在你的手牌中。",409);
  if (!playable(state,card)) throw new GameRuleError("card_not_playable","当前不能打出这张牌。",409);
  if ((card.type==="wild"||card.type==="wild4")&&!COLORS.includes(chosenColor)) throw new GameRuleError("color_required","万能牌必须选择一种颜色。");
  expireUno(state,now);
  const oldColor=state.currentColor;
  const originIndex=state.currentIndex;
  const affectedIndex=nextIndex(state,originIndex);
  const affectedPlayer=state.players[affectedIndex]||null;
  const wasLegal=card.type!=="wild4"||!player.hand.some((other,otherIndex)=>otherIndex!==index&&other.color===oldColor);
  player.hand.splice(index,1);
  state.discard.push(card);
  state.currentColor=card.color||chosenColor;
  state.drawnCardId=null;
  publicEvent(state,{
    kind:"card-play",actorId:player.id,targetId:["draw2","wild4","skip"].includes(card.type)?affectedPlayer?.id||null:null,
    card:publicCard(card),chosenColor:card.color?null:chosenColor,text:`${player.name} 打出 ${describeCard(card)}`
  },now);
  addLog(state,`${player.name} 打出${describeCard(card)}${card.color?"":`，选择${{red:"红色",yellow:"黄色",green:"绿色",blue:"蓝色"}[chosenColor]}`}`,now);
  if (player.hand.length===1) {
    if (player.unoCalled) addLog(state,`${player.name} 已正确喊 UNO`,now);
    else {
      state.unoVulnerableId=player.id;
      publicEvent(state,{kind:"uno-vulnerable",actorId:player.id,targetId:player.id,text:`${player.name} 只剩一张牌，但还没有喊 UNO`},now);
      addLog(state,`${player.name} 只剩1张牌，但还没有喊 UNO`,now);
    }
  }
  player.unoCalled=false;
  if (card.type==="wild4") {
    state.pendingDraw+=4;
    state.pendingWild={offenderId:player.id,wasLegal,amount:4};
    state.currentIndex=nextIndex(state,state.currentIndex);
    publicEvent(state,{kind:"penalty-window",actorId:player.id,targetId:currentPlayer(state)?.id||null,count:state.pendingDraw,challengeAllowed:true,text:`${currentPlayer(state)?.name||"下一位玩家"} 面临累计 +${state.pendingDraw}`},now);
    if (!player.hand.length) state.pendingWinnerId=player.id;
    beginTurn(state,now);
    return;
  }
  if (!player.hand.length) { finish(state,player.id,now); return; }
  if (card.type==="draw2") {
    state.pendingDraw+=2; state.pendingWild=null; state.currentIndex=nextIndex(state,state.currentIndex);
    publicEvent(state,{kind:"penalty-window",actorId:player.id,targetId:currentPlayer(state)?.id||null,count:state.pendingDraw,challengeAllowed:false,text:`${currentPlayer(state)?.name||"下一位玩家"} 面临累计 +${state.pendingDraw}`},now);
    beginTurn(state,now); return;
  }
  state.pendingWild=null;
  if (card.type==="skip") {
    state.currentIndex=nextIndex(state,state.currentIndex,2);
    publicEvent(state,{kind:"player-skipped",actorId:player.id,targetId:affectedPlayer?.id||null,nextPlayerId:currentPlayer(state)?.id||null,text:`${affectedPlayer?.name||"下一位玩家"} 被跳过`},now);
  }
  else if (card.type==="reverse") {
    state.direction*=-1; state.currentIndex=nextIndex(state,state.currentIndex,state.players.length===2?2:1);
    publicEvent(state,{kind:"direction-reversed",actorId:player.id,targetId:currentPlayer(state)?.id||null,direction:state.direction,text:`${player.name} 反转了出牌方向`},now);
  }
  else state.currentIndex=nextIndex(state,state.currentIndex);
  beginTurn(state,now);
}
function challengeWild(state,player,{now,random}) {
  if (!state.pendingWild) throw new GameRuleError("challenge_unavailable","当前没有可以质疑的 +4。",409);
  expireUno(state,now);
  const info=state.pendingWild;
  const offender=playerById(state,info.offenderId);
  if (!offender) throw new GameRuleError("challenge_unavailable","上一位出牌者已经离开房间。",409);
  publicEvent(state,{kind:"challenge-start",actorId:player.id,targetId:offender.id,text:`${player.name} 质疑 ${offender.name} 的 +4`},now);
  if (!info.wasLegal) {
    const cards=drawMany(state,offender,4,random,now);
    state.pendingDraw=Math.max(0,state.pendingDraw-info.amount);
    state.pendingWild=null; state.pendingWinnerId=null;
    publicEvent(state,{kind:"challenge-result",actorId:player.id,targetId:offender.id,successful:true,count:4,text:`质疑成功，${offender.name} 摸 4 张`},now);
    privateDrawEvent(state,offender,cards,"challenge-penalty",now);
    addLog(state,`${player.name} 质疑成功，${offender.name} 非法使用 +4 并摸4张`,now);
    beginTurn(state,now);
    return;
  }
  const count=state.pendingDraw+2;
  const cards=drawMany(state,player,count,random,now);
  publicEvent(state,{kind:"challenge-result",actorId:player.id,targetId:player.id,offenderId:offender.id,successful:false,count,text:`质疑失败，${player.name} 摸 ${count} 张并跳过`},now);
  privateDrawEvent(state,player,cards,"failed-challenge",now);
  addLog(state,`${player.name} 质疑失败，摸取 ${count} 张并跳过`,now);
  const pendingWinnerId=state.pendingWinnerId;
  clearPenalty(state);
  if (pendingWinnerId) finish(state,pendingWinnerId,now); else advance(state,now);
}
function timeoutCurrent(state,{now,random}) {
  if (state.phase!=="playing") return false;
  const player=currentPlayer(state);
  expireUno(state,now);
  if (state.pendingDraw>0) acceptPenalty(state,player,{now,random,reason:"超时"});
  else {
    const cards=drawMany(state,player,1,random,now);
    publicEvent(state,{kind:"draw-action",actorId:player.id,targetId:player.id,count:1,reason:"timeout",text:`${player.name} 超时，自动摸 1 张`},now);
    privateDrawEvent(state,player,cards,"timeout",now);
    addLog(state,`${player.name} 超时，自动摸1张并结束回合`,now);
    advance(state,now);
  }
  return true;
}

export function createLobby({capacity,host}) {
  return {stateVersion:STATE_VERSION,phase:"lobby",capacity:assertCapacity(capacity),players:[makePlayer({...host,isHost:true})],deck:[],discard:[],currentColor:null,currentIndex:0,direction:1,pendingDraw:0,pendingWild:null,pendingWinnerId:null,drawnCardId:null,unoVulnerableId:null,winnerId:null,deadline:0,logs:[],logSequence:0,presentationEvents:[],privatePresentationEvents:{},presentationSequence:0};
}
export function addPlayer(state,player) {
  if (state.phase!=="lobby") throw new GameRuleError("game_started","游戏已经开始，不能中途加入。",409);
  if (state.players.length>=state.capacity) throw new GameRuleError("room_full","房间人数已满。",409);
  if (playerById(state,player.id)) throw new GameRuleError("player_exists","该玩家已经在房间中。",409);
  const next=makePlayer(player); state.players.push(next); return next;
}
export function removePlayer(state,actorId,playerId,{now=Date.now(),random=Math.random}={}) {
  requireHost(state,actorId);
  const index=state.players.findIndex((player)=>player.id===String(playerId));
  const target=state.players[index];
  if (!target||target.isHost) throw new GameRuleError("invalid_kick_target","无法移出该玩家。");
  if (state.phase==="lobby") { state.players.splice(index,1); return target; }
  if (state.phase==="ended") { state.players.splice(index,1); return target; }
  const currentId=currentPlayer(state)?.id;
  const nextId=currentId===target.id?state.players[nextIndex(state,index)]?.id:currentId;
  state.deck=shuffle([...state.deck,...target.hand],random);
  state.players.splice(index,1);
  if (state.unoVulnerableId===target.id) state.unoVulnerableId=null;
  if (state.pendingWild?.offenderId===target.id) state.pendingWild=null;
  if (state.pendingWinnerId===target.id) state.pendingWinnerId=null;
  if (state.players.length<2) { finish(state,state.players[0]?.id||null,now); return target; }
  state.currentIndex=Math.max(0,state.players.findIndex((player)=>player.id===nextId));
  if (currentId===target.id) { state.drawnCardId=null; beginTurn(state,now); }
  return target;
}
export function canChangeSeats(state) { return state.phase==="lobby"; }
export function vacateSeat(state,playerId) {
  if(!canChangeSeats(state)) throw new GameRuleError("seat_change_unavailable","游戏开始后不能转入旁观席。",409);
  const index=state.players.findIndex((player)=>player.id===String(playerId));
  const target=state.players[index];
  if(!target||target.isHost) throw new GameRuleError("invalid_seat_change","房主必须留在玩家席。",403);
  state.players.splice(index,1);
  return target;
}
export function setPresence(state,playerId,connected,{now=Date.now(),random=Math.random}={}) {
  const player=playerById(state,playerId);
  if (!player||player.connected===Boolean(connected)) return false;
  player.connected=Boolean(connected);
  if (!connected&&state.phase==="playing"&&currentPlayer(state)?.id===player.id) timeoutCurrent(state,{now,random});
  return true;
}
export function applyAction(state,actorId,action,{now=Date.now(),random=Math.random}={}) {
  const actor=requireActor(state,actorId); const type=action?.type;
  if (type==="setCapacity") {
    requireHost(state,actorId); if(state.phase!=="lobby") throw new GameRuleError("game_started","游戏开始后不能修改人数。",409);
    const capacity=assertCapacity(action.capacity); if(capacity<state.players.length) throw new GameRuleError("capacity_too_small","人数不能少于已加入玩家数。",409); state.capacity=capacity; return;
  }
  if (type==="start") {
    requireHost(state,actorId); if(state.phase!=="lobby") throw new GameRuleError("already_started","游戏已经开始。",409);
    if(state.players.length!==state.capacity) throw new GameRuleError("players_missing",`需要 ${state.capacity} 人到齐。`,409);
    if(state.players.some((player)=>!player.connected)) throw new GameRuleError("players_offline","所有玩家在线后才能开始。",409);
    state.phase="playing"; state.deck=createDeck(random); state.discard=[]; state.direction=1; state.currentIndex=0; state.pendingDraw=0; state.pendingWild=null; state.pendingWinnerId=null; state.drawnCardId=null; state.unoVulnerableId=null; state.winnerId=null; state.logs=[]; state.logSequence=0;
    state.players.forEach((player)=>{player.hand=[];player.unoCalled=false;});
    for(let count=0;count<INITIAL_HAND_SIZE;count+=1) for(const player of state.players) player.hand.push(drawRaw(state,random,now));
    const numberIndex=state.deck.findIndex((card)=>card.type==="number");
    const [first]=state.deck.splice(numberIndex,1); state.discard.push(first); state.currentColor=first.color;
    publicEvent(state,{kind:"game-start",actorId:currentPlayer(state)?.id||null,card:publicCard(first),text:`游戏开始，首张牌是 ${describeCard(first)}`},now);
    for (const player of state.players) privateEvent(state,player.id,{kind:"initial-hand",actorId:player.id,cards:player.hand.map(publicCard),count:player.hand.length,text:`你的起手牌：${player.hand.map(describeCard).join("、")}`},now);
    addLog(state,`游戏开始，首张牌是${describeCard(first)}`,now); beginTurn(state,now); return;
  }
  if (type==="end") {
    requireHost(state,actorId); if(state.phase==="lobby") throw new GameRuleError("game_not_started","当前没有可结束的游戏。",409); resetToLobby(state); return;
  }
  if (state.phase!=="playing") throw new GameRuleError("game_not_playing","当前牌局没有进行。",409);
  if (!actor.connected) throw new GameRuleError("not_connected","重新连接房间后才能行动。",409);
  if (type==="catchUno") {
    const offender=playerById(state,state.unoVulnerableId);
    if(!offender||offender.id===actor.id) throw new GameRuleError("catch_unavailable","当前没有可抓的 UNO。",409);
    const cards=drawMany(state,offender,2,random,now); state.unoVulnerableId=null;
    publicEvent(state,{kind:"uno-caught",actorId:actor.id,targetId:offender.id,count:2,text:`${actor.name} 抓到 ${offender.name} 未喊 UNO`},now);
    privateDrawEvent(state,offender,cards,"uno-penalty",now);
    addLog(state,`${actor.name} 抓到 ${offender.name} 未喊 UNO，后者摸2张`,now); return;
  }
  const current=currentPlayer(state);
  if (!current||current.id!==actor.id) throw new GameRuleError("not_your_turn","现在还没有轮到你。",409);
  if (type==="callUno") {
    if(actor.hand.length!==2||!actor.hand.some((card)=>playable(state,card))) throw new GameRuleError("uno_unavailable","当前不能喊 UNO。",409);
    actor.unoCalled=true;
    publicEvent(state,{kind:"uno-call",actorId:actor.id,targetId:actor.id,text:`${actor.name} 喊出 UNO！`},now);
    addLog(state,`${actor.name} 喊了 UNO！`,now); return;
  }
  if (type==="challenge") { challengeWild(state,actor,{now,random}); return; }
  if (type==="acceptPenalty") { acceptPenalty(state,actor,{now,random}); return; }
  if (type==="draw") {
    if(state.pendingDraw>0) { acceptPenalty(state,actor,{now,random}); return; }
    if(state.drawnCardId) throw new GameRuleError("already_drawn","本回合已经摸过牌。",409);
    expireUno(state,now); const card=drawRaw(state,random,now); actor.hand.push(card);
    publicEvent(state,{kind:"draw-action",actorId:actor.id,targetId:actor.id,count:1,reason:"voluntary",text:`${actor.name} 摸了 1 张牌`},now);
    privateDrawEvent(state,actor,[card],"voluntary",now);
    addLog(state,`${actor.name} 摸了1张牌`,now);
    if(playable(state,card)) { state.drawnCardId=card.id; state.deadline=now+ACTION_SECONDS*1000; }
    else advance(state,now); return;
  }
  if (type==="pass") {
    if(!state.drawnCardId) throw new GameRuleError("pass_unavailable","只有摸到可出的牌后才能保留并结束回合。",409);
    expireUno(state,now);
    publicEvent(state,{kind:"draw-pass",actorId:actor.id,targetId:actor.id,text:`${actor.name} 保留摸到的牌并结束回合`},now);
    addLog(state,`${actor.name} 保留摸到的牌`,now); advance(state,now); return;
  }
  if (type==="play") { playCard(state,actor,String(action.cardId||""),action.color,{now,random}); return; }
  throw new GameRuleError("unknown_action","无法识别该游戏操作。");
}
export function handleTimeout(state,{now=Date.now(),random=Math.random}={}) {
  if(state.phase!=="playing"||!state.deadline||now<state.deadline) return false;
  return timeoutCurrent(state,{now,random});
}
export function getDeadline(state) { return state.phase==="playing"?Number(state.deadline)||0:0; }
function presentationFor(state,viewer) {
  const privateEvents=viewer?state.privatePresentationEvents?.[viewer.id]||[]:[];
  return [...state.presentationEvents,...privateEvents].sort((left,right)=>left.sequence-right.sequence).map((event)=>structuredClone(event));
}
function buildPublicView(state,{viewer=null,playableCardIds=[],permissions}) {
  const current=currentPlayer(state); const ownTurn=state.phase==="playing"&&current?.id===viewer?.id;
  return {selfId:viewer?.id||null,phase:state.phase,capacity:state.capacity,currentIndex:state.currentIndex,direction:state.direction,deckCount:state.deck.length,discard:topCard(state)?[{...topCard(state)}]:[],currentColor:state.currentColor,pendingDraw:state.pendingDraw,drawnCardId:ownTurn?state.drawnCardId:null,unoVulnerableId:state.unoVulnerableId,winnerId:state.winnerId,deadline:state.deadline,logs:state.logs.map((entry)=>({...entry})),presentationEvents:presentationFor(state,viewer),playableCardIds,players:state.players.map((player)=>({id:player.id,name:player.name,isHost:player.isHost,connected:player.connected,unoCalled:player.unoCalled,hand:player.id===viewer?.id?player.hand.map((card)=>({...card})):player.hand.map(()=>null)})),permissions};
}
export function buildView(state,viewerId) {
  const viewer=requireActor(state,viewerId); const current=currentPlayer(state); const ownTurn=state.phase==="playing"&&current?.id===viewer.id;
  const playableCardIds=ownTurn?viewer.hand.filter((card)=>playable(state,card)).map((card)=>card.id):[];
  return buildPublicView(state,{viewer,playableCardIds,permissions:{canManage:viewer.isHost,canKick:viewer.isHost,canSetCapacity:viewer.isHost&&state.phase==="lobby",canStart:viewer.isHost&&state.phase==="lobby",canEnd:viewer.isHost&&state.phase!=="lobby",canDraw:ownTurn&&!state.pendingDraw&&!state.drawnCardId,canPass:ownTurn&&Boolean(state.drawnCardId),canAcceptPenalty:ownTurn&&state.pendingDraw>0,canChallenge:ownTurn&&Boolean(state.pendingWild),canCatchUno:state.phase==="playing"&&Boolean(state.unoVulnerableId)&&state.unoVulnerableId!==viewer.id,canCallUno:ownTurn&&viewer.hand.length===2&&playableCardIds.length>0}});
}
export function buildSpectatorView(state) {
  return buildPublicView(state,{viewer:null,playableCardIds:[],permissions:{canManage:false,canKick:false,canSetCapacity:false,canStart:false,canEnd:false,canDraw:false,canPass:false,canAcceptPenalty:false,canChallenge:false,canCatchUno:false,canCallUno:false}});
}
export function validateState(state) {
  if (!state||!Array.isArray(state.players)||!Array.isArray(state.deck)||!Array.isArray(state.discard)) throw new Error("Invalid game5 state");
  try { validatePresentationState(state); }
  catch { throw new Error("Invalid game5 public presentation events"); }
  if (!state.privatePresentationEvents||typeof state.privatePresentationEvents!=="object"||Array.isArray(state.privatePresentationEvents)) throw new Error("Invalid game5 private presentation events");
  const sequences=new Set(state.presentationEvents.map((event)=>event.sequence));
  for (const events of Object.values(state.privatePresentationEvents)) {
    try { validatePresentationState({presentationEvents:events,presentationSequence:state.presentationSequence}); }
    catch { throw new Error("Invalid game5 private presentation events"); }
    for (const event of events) {
      if (!event.private||sequences.has(event.sequence)) throw new Error("Invalid game5 private presentation event sequence");
      sequences.add(event.sequence);
    }
  }
  return true;
}
export function serializeState(state) { validateState(state); return structuredClone(state); }
export function restoreState(serializedState) {
  if(serializedState?.stateVersion!==STATE_VERSION) throw new Error(`Unsupported game5 state version: ${serializedState?.stateVersion}`);
  const state=structuredClone(serializedState);
  state.privatePresentationEvents=state.privatePresentationEvents&&typeof state.privatePresentationEvents==="object"&&!Array.isArray(state.privatePresentationEvents)?state.privatePresentationEvents:{};
  normalizePresentationState(state);
  const latestPrivate=Object.values(state.privatePresentationEvents).flat().reduce((maximum,event)=>Math.max(maximum,Number(event?.sequence)||0),0);
  state.presentationSequence=Math.max(state.presentationSequence,latestPrivate);
  validateState(state);
  return state;
}
