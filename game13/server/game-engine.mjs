import {
  ACTION_SECONDS, DECISION_SECONDS, INITIAL_CARD_COUNT, INITIAL_PEEK_SECONDS,
  MAX_PLAYERS, MIN_PLAYERS, REVEAL_SECONDS, TARGET_SECONDS,
  createDeck, powerForValue, scoreRound, shuffle
} from "../rules.mjs";

export { ACTION_SECONDS };
export const STATE_VERSION = 1;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = "GameRuleError"; this.code = code; this.status = status;
  }
}

const text = (value, fallback = "玩家") => String(value ?? "").trim().slice(0,12) || fallback;
const playerById = (state,id) => state.players.find((player) => player.id === String(id)) || null;
const slotById = (player,id) => player?.slots.find((slot) => slot.slotId === String(id)) || null;
const currentPlayer = (state) => state.players[state.currentIndex] || null;

function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", `游戏人数必须为 ${MIN_PLAYERS}～${MAX_PLAYERS} 人。`);
  }
  return capacity;
}
function requireActor(state,id) {
  const actor = playerById(state,id);
  if (!actor) throw new GameRuleError("not_a_player","你不属于这个房间。",403);
  return actor;
}
function requireHost(state,id) {
  const actor = requireActor(state,id);
  if (!actor.isHost) throw new GameRuleError("host_required","只有房主可以执行此操作。",403);
  return actor;
}
function requireCurrent(state,actor) {
  if (currentPlayer(state)?.id !== actor.id) throw new GameRuleError("not_your_turn","现在还没有轮到你。",409);
}
function makePlayer({id,name,isHost=false,connected=false}) {
  if (!id) throw new GameRuleError("player_id_required","缺少玩家身份。");
  return {id:String(id),name:text(name,isHost?"房主":"玩家"),isHost:Boolean(isHost),connected:Boolean(connected),slots:[],score:0,lastRoundScore:0,resetUsed:false,initialPeekIds:[]};
}
function addLog(state,message,now) {
  state.logs.unshift({id:`log_${state.logSequence += 1}`,text:message,at:now});
  if (state.logs.length > 100) state.logs.length = 100;
}
function drawCard(state) {
  const card = state.deck.pop();
  if (!card) throw new GameRuleError("deck_empty","牌库已经耗尽。",409);
  return card;
}
function makeSlot(state,card,faceUp=false) {
  return {slotId:`slot_${state.slotSequence += 1}`,card,faceUp:Boolean(faceUp)};
}
function setDeadline(state,now,seconds) { state.deadline = now + seconds * 1000; }
function nextIndex(state,index=state.currentIndex) { return (index + 1) % state.players.length; }
function setTargetNotice(state,{type,actorId,targetPlayerId,targetSlotId},now) {
  state.targetNotice={
    id:`${type}_${now}_${actorId}_${targetPlayerId}_${targetSlotId}`,
    type,actorId,targetPlayerId,targetSlotId,until:now+REVEAL_SECONDS*1000
  };
}

function resetToLobby(state) {
  state.phase="lobby"; state.round=0; state.deck=[]; state.discard=[]; state.currentIndex=0;
  state.pending=null; state.privateReveal=null; state.targetNotice=null; state.cabo=null; state.deadline=0;
  state.roundResult=[]; state.winnerIds=[]; state.logs=[]; state.logSequence=0; state.slotSequence=0;
  for (const player of state.players) {
    player.slots=[]; player.score=0; player.lastRoundScore=0; player.resetUsed=false; player.initialPeekIds=[];
  }
}

function chooseNextStarter(state) {
  const best = Math.min(...state.players.map((player) => player.lastRoundScore));
  const candidates = new Set(state.players.filter((player) => player.lastRoundScore === best).map((player) => player.id));
  const oldIndex = Math.max(0,state.players.findIndex((player) => player.id === state.startingPlayerId));
  for (let offset=1; offset<=state.players.length; offset+=1) {
    const index=(oldIndex+offset)%state.players.length;
    if (candidates.has(state.players[index].id)) return index;
  }
  return 0;
}

function beginRound(state,random,now,{first=false}={}) {
  state.round += 1;
  state.deck = createDeck(random);
  state.discard = [];
  state.pending = null;
  state.privateReveal = null;
  state.targetNotice = null;
  state.cabo = null;
  state.roundResult = [];
  state.winnerIds = [];
  state.slotSequence = 0;
  if (!first) state.currentIndex = chooseNextStarter(state);
  state.startingPlayerId = state.players[state.currentIndex].id;
  for (const player of state.players) {
    player.slots=[]; player.initialPeekIds=[];
  }
  for (let count=0; count<INITIAL_CARD_COUNT; count+=1) {
    for (const player of state.players) player.slots.push(makeSlot(state,drawCard(state)));
  }
  state.phase="initialPeek";
  setDeadline(state,now,INITIAL_PEEK_SECONDS);
  addLog(state,`第 ${state.round} 轮开始，等待所有玩家查看两张初始牌。`,now);
}

function startInitialReveal(state,now) {
  state.phase="initialReveal";
  setDeadline(state,now,REVEAL_SECONDS);
}

function beginTurn(state,now) {
  state.phase="turn"; state.pending=null; state.privateReveal=null;
  setDeadline(state,now,ACTION_SECONDS);
}

function finishRound(state,now,reason) {
  const result=scoreRound(state.players,state.cabo?.callerId || null);
  state.roundResult=result;
  for (const item of result) {
    const player=playerById(state,item.playerId);
    player.lastRoundScore=item.score;
    player.score+=item.score;
    item.resetApplied=false;
    if (player.score===100 && !player.resetUsed) {
      player.score=50; player.resetUsed=true; item.resetApplied=true;
    }
    item.totalScore=player.score;
  }
  state.pending=null; state.privateReveal=null; state.targetNotice=null; state.cabo=null; state.deadline=0;
  const over=state.players.some((player)=>player.score>100);
  if (over) {
    const lowest=Math.min(...state.players.map((player)=>player.score));
    let winners=state.players.filter((player)=>player.score===lowest);
    if (winners.length>1) {
      const bestLast=Math.min(...winners.map((player)=>player.lastRoundScore));
      winners=winners.filter((player)=>player.lastRoundScore===bestLast);
    }
    state.winnerIds=winners.map((player)=>player.id); state.phase="ended";
  } else state.phase="roundEnd";
  addLog(state,`${reason}，第 ${state.round} 轮结束。`,now);
}

function finishTurn(state,now) {
  if (!state.deck.length) return finishRound(state,now,"牌库耗尽");
  if (state.cabo) {
    const completed=currentPlayer(state)?.id;
    state.cabo.remainingIds=state.cabo.remainingIds.filter((id)=>id!==completed);
    if (!state.cabo.remainingIds.length) return finishRound(state,now,"所有最终回合完成");
    const nextId=state.cabo.remainingIds[0];
    state.currentIndex=state.players.findIndex((player)=>player.id===nextId);
  } else state.currentIndex=nextIndex(state);
  beginTurn(state,now);
}

function addDiscard(state,card) { state.discard.push(card); }

function exchangeCards(state,actor,action,now) {
  const pending=state.pending;
  const ids=[...new Set((action.slotIds||[]).map(String))];
  if (!ids.length) throw new GameRuleError("slots_required","请至少选择一张自己的牌。",409);
  const selected=ids.map((id)=>slotById(actor,id));
  if (selected.some((slot)=>!slot)) throw new GameRuleError("invalid_slot","选择中包含不存在的牌位。",409);
  const indexes=selected.map((slot)=>actor.slots.indexOf(slot)).sort((a,b)=>a-b);
  const matches=selected.every((slot)=>slot.card.value===selected[0].card.value);
  if (ids.length===1 || matches) {
    const incoming=makeSlot(state,pending.card,pending.source==="discard");
    for (const slot of selected) addDiscard(state,slot.card);
    actor.slots=actor.slots.filter((slot)=>!ids.includes(slot.slotId));
    actor.slots.splice(indexes[0],0,incoming);
    addLog(state,`${actor.name} 用抽到的牌替换了 ${ids.length} 张牌${ids.length>1?"，匹配成功":""}。`,now);
  } else {
    for (const slot of selected) slot.faceUp=true;
    state.pending.failedExchange={selectedCount:ids.length};
    state.phase="failedExchange";
    setDeadline(state,now,DECISION_SECONDS);
    addLog(state,`${actor.name} 的多牌匹配失败，所选牌已经公开，等待放置新增牌。`,now);
    return;
  }
  state.pending=null;
  finishTurn(state,now);
}

function placeFailedExchange(state,actor,action,now) {
  const pending=state.pending;
  if (!pending?.failedExchange) throw new GameRuleError("placement_unavailable","当前没有等待放置的匹配失败牌。",409);
  if (action.end!=="left" && action.end!=="right") throw new GameRuleError("invalid_placement","请选择放在手牌最左侧或最右侧。",409);
  const incoming=makeSlot(state,pending.card,pending.source==="discard");
  if (action.end==="left") actor.slots.unshift(incoming); else actor.slots.push(incoming);
  let penaltyAdded=false;
  if (pending.failedExchange.selectedCount>=3 && state.deck.length) {
    const penalty=makeSlot(state,drawCard(state),false);
    if (action.end==="left") actor.slots.unshift(penalty); else actor.slots.push(penalty);
    penaltyAdded=true;
  }
  addLog(state,`${actor.name} 将匹配失败后的新增牌放在了${action.end==="left"?"左":"右"}侧${penaltyAdded?"，并获得一张惩罚牌":""}。`,now);
  state.pending=null;
  finishTurn(state,now);
}

function usePower(state,actor,action,now) {
  const pending=state.pending;
  if (pending?.source!=="deck") throw new GameRuleError("power_unavailable","只有牌库抽到并弃掉的能力牌可以发动。",409);
  const power=powerForValue(pending.card.value);
  if (!power) throw new GameRuleError("power_unavailable","这张牌没有特殊能力。",409);
  if (power==="peek") {
    const slot=slotById(actor,action.slotId);
    if (!slot || slot.faceUp) throw new GameRuleError("invalid_peek_target","请选择自己的一张背面牌。",409);
    addDiscard(state,pending.card); state.pending=null;
    state.privateReveal={viewerId:actor.id,targetPlayerId:actor.id,slotId:slot.slotId,power,until:now+REVEAL_SECONDS*1000};
  } else if (power==="spy") {
    const target=playerById(state,action.targetPlayerId); const slot=slotById(target,action.slotId);
    if (!target || target.id===actor.id || !slot || slot.faceUp) throw new GameRuleError("invalid_spy_target","请选择另一名玩家的一张背面牌。",409);
    addDiscard(state,pending.card); state.pending=null;
    state.privateReveal={viewerId:actor.id,targetPlayerId:target.id,slotId:slot.slotId,power,until:now+REVEAL_SECONDS*1000};
    setTargetNotice(state,{type:"spy",actorId:actor.id,targetPlayerId:target.id,targetSlotId:slot.slotId},now);
  } else {
    const own=slotById(actor,action.ownSlotId); const target=playerById(state,action.targetPlayerId); const other=slotById(target,action.targetSlotId);
    if (!own || !target || target.id===actor.id || !other) throw new GameRuleError("invalid_swap_target","请选择自己和一名对手各一张牌。",409);
    addDiscard(state,pending.card); state.pending=null;
    [own.card,other.card]=[other.card,own.card];
    [own.faceUp,other.faceUp]=[other.faceUp,own.faceUp];
    setTargetNotice(state,{type:"swap",actorId:actor.id,targetPlayerId:target.id,targetSlotId:other.slotId},now);
    addLog(state,`${actor.name} 交换了自己和 ${target.name} 的一张牌。`,now);
    return finishTurn(state,now);
  }
  state.phase="reveal"; state.deadline=state.privateReveal.until;
  addLog(state,`${actor.name} 发动了${power==="peek"?"查看":"侦察"}能力。`,now);
}

function autoInitialPeek(state) {
  for (const player of state.players) if (player.initialPeekIds.length!==2) player.initialPeekIds=player.slots.slice(0,2).map((slot)=>slot.slotId);
}

export function createLobby({capacity,host}) {
  return {stateVersion:STATE_VERSION,phase:"lobby",capacity:assertCapacity(capacity),round:0,players:[makePlayer({...host,isHost:true})],deck:[],discard:[],currentIndex:0,startingPlayerId:null,pending:null,privateReveal:null,targetNotice:null,cabo:null,deadline:0,roundResult:[],winnerIds:[],logs:[],logSequence:0,slotSequence:0};
}

export function addPlayer(state,player) {
  if (state.phase!=="lobby") throw new GameRuleError("game_started","游戏已经开始，不能中途加入。",409);
  if (state.players.length>=state.capacity) throw new GameRuleError("room_full","房间人数已满。",409);
  if (playerById(state,player.id)) throw new GameRuleError("player_exists","该玩家已经在房间中。",409);
  const next=makePlayer(player); state.players.push(next); return next;
}

export function removePlayer(state,actorId,playerId) {
  requireHost(state,actorId);
  const index=state.players.findIndex((player)=>player.id===String(playerId)); const target=state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target","无法移出该玩家。");
  state.players.splice(index,1);
  if (state.phase!=="lobby") resetToLobby(state);
  return target;
}

export function setPresence(state,playerId,connected) {
  const player=playerById(state,playerId);
  if (!player || player.connected===Boolean(connected)) return false;
  player.connected=Boolean(connected); return true;
}

export function applyAction(state,actorId,action,{now=Date.now(),random=Math.random}={}) {
  const actor=requireActor(state,actorId); const type=action?.type;
  if (type==="setCapacity") {
    requireHost(state,actorId);
    if (state.phase!=="lobby") throw new GameRuleError("game_started","游戏开始后不能修改人数。",409);
    const capacity=assertCapacity(action.capacity);
    if (capacity<state.players.length) throw new GameRuleError("capacity_too_small","人数不能少于已经加入的玩家数。",409);
    state.capacity=capacity; return;
  }
  if (type==="start") {
    requireHost(state,actorId);
    if (state.phase==="roundEnd") {
      if (state.players.some((player)=>!player.connected)) throw new GameRuleError("players_offline","所有玩家在线后才能开始下一轮。",409);
      return beginRound(state,random,now);
    }
    if (state.phase!=="lobby") throw new GameRuleError("already_started","游戏已经开始。",409);
    if (state.players.length!==state.capacity) throw new GameRuleError("players_missing",`需要 ${state.capacity} 人到齐。`,409);
    if (state.players.some((player)=>!player.connected)) throw new GameRuleError("players_offline","所有玩家在线后才能开始。",409);
    for (const player of state.players) {player.score=0;player.lastRoundScore=0;player.resetUsed=false;}
    state.round=0; state.currentIndex=0; state.logs=[]; state.logSequence=0;
    return beginRound(state,random,now,{first:true});
  }
  if (type==="end") {
    requireHost(state,actorId);
    if (state.phase==="lobby") throw new GameRuleError("game_not_started","当前没有可结束的游戏。",409);
    return resetToLobby(state);
  }
  if (!actor.connected) throw new GameRuleError("not_connected","重新连接房间后才能行动。",409);
  if (state.phase==="initialPeek" && type==="initialPeek") {
    if (actor.initialPeekIds.length) throw new GameRuleError("already_peeked","你已经选择过初始牌。",409);
    const ids=[...new Set((action.slotIds||[]).map(String))];
    if (ids.length!==2 || ids.some((id)=>!slotById(actor,id))) throw new GameRuleError("invalid_initial_peek","请选择自己的两张初始牌。",409);
    actor.initialPeekIds=ids;
    if (state.players.every((player)=>player.initialPeekIds.length===2)) startInitialReveal(state,now);
    return;
  }
  if (state.phase==="reveal" && type==="closeReveal") {
    if (state.privateReveal?.viewerId!==actor.id) throw new GameRuleError("reveal_unavailable","当前没有属于你的查看窗口。",409);
    state.privateReveal=null; return finishTurn(state,now);
  }
  if (state.phase==="failedExchange") {
    requireCurrent(state,actor);
    if (type!=="placeFailedExchange") throw new GameRuleError("placement_required","请先决定把新增牌放在手牌左侧还是右侧。",409);
    return placeFailedExchange(state,actor,action,now);
  }
  if (state.phase!=="turn" && state.phase!=="drawn") throw new GameRuleError("action_unavailable","当前阶段不能执行这个操作。",409);
  requireCurrent(state,actor);
  if (state.phase==="turn") {
    if (type==="callCabo") {
      if (state.cabo) throw new GameRuleError("cabo_already_called","本轮已经有人宣布CABO。",409);
      const remaining=[]; let index=state.currentIndex;
      for (let count=1;count<state.players.length;count+=1) {index=nextIndex(state,index);remaining.push(state.players[index].id);}
      state.cabo={callerId:actor.id,remainingIds:remaining}; state.currentIndex=state.players.findIndex((player)=>player.id===remaining[0]);
      addLog(state,`${actor.name} 宣布了 CABO，其他玩家各有最后一个回合。`,now); return beginTurn(state,now);
    }
    if (type==="drawDeck") {
      if (!state.deck.length) return finishRound(state,now,"牌库耗尽");
      state.pending={card:drawCard(state),source:"deck"}; state.phase="drawn"; setDeadline(state,now,DECISION_SECONDS); return;
    }
    if (type==="drawDiscard") {
      if (!state.discard.length) throw new GameRuleError("discard_empty","弃牌堆还是空的。",409);
      state.pending={card:state.discard.pop(),source:"discard"}; state.phase="drawn"; setDeadline(state,now,DECISION_SECONDS); return;
    }
    throw new GameRuleError("unknown_action","无法识别这个回合操作。");
  }
  if (type==="exchange") return exchangeCards(state,actor,action,now);
  if (type==="discardDrawn") {
    if (state.pending?.source!=="deck") throw new GameRuleError("must_exchange","从弃牌堆拿取的牌必须用于交换。",409);
    addDiscard(state,state.pending.card); state.pending=null; addLog(state,`${actor.name} 弃掉了牌库抽到的牌。`,now); return finishTurn(state,now);
  }
  if (type==="usePower") return usePower(state,actor,action,now);
  throw new GameRuleError("unknown_action","无法识别这个抽牌操作。");
}

export function handleTimeout(state,{now=Date.now(),random=Math.random}={}) {
  if (!state.deadline || now<state.deadline) return false;
  if (state.phase==="initialPeek") {autoInitialPeek(state);startInitialReveal(state,now);return true;}
  if (state.phase==="initialReveal") {for(const player of state.players)player.initialPeekIds=[];beginTurn(state,now);return true;}
  if (state.phase==="reveal") {state.privateReveal=null;finishTurn(state,now);return true;}
  if (state.phase==="turn") {
    if (!state.deck.length) finishRound(state,now,"牌库耗尽");
    else {const actor=currentPlayer(state);addDiscard(state,drawCard(state));addLog(state,`${actor.name} 回合超时，系统抽牌并弃掉。`,now);finishTurn(state,now);}
    return true;
  }
  if (state.phase==="drawn") {
    const actor=currentPlayer(state);
    if (state.pending.source==="deck") {addDiscard(state,state.pending.card);state.pending=null;addLog(state,`${actor.name} 决策超时，抽到的牌被弃掉。`,now);finishTurn(state,now);}
    else exchangeCards(state,actor,{slotIds:[actor.slots[0].slotId],end:"right"},now);
    return true;
  }
  if (state.phase==="failedExchange") {
    placeFailedExchange(state,currentPlayer(state),{end:"right"},now);
    return true;
  }
  return false;
}

export function getDeadline(state) { return Number(state.deadline)||0; }

function visibleSlot(slot,viewerId,ownerId,state) {
  const temporary=state.privateReveal && state.privateReveal.viewerId===viewerId && state.privateReveal.targetPlayerId===ownerId && state.privateReveal.slotId===slot.slotId;
  const initial=(state.phase==="initialPeek"||state.phase==="initialReveal") && viewerId===ownerId && playerById(state,ownerId).initialPeekIds.includes(slot.slotId);
  const showdown=state.phase==="roundEnd"||state.phase==="ended";
  return {slotId:slot.slotId,faceUp:slot.faceUp||showdown,value:slot.faceUp||temporary||initial||showdown?slot.card.value:null,temporary:Boolean(temporary||initial)};
}

export function buildView(state,viewerId) {
  const viewer=requireActor(state,viewerId); const current=currentPlayer(state);
  const pendingForViewer=state.pending && current?.id===viewer.id ? {source:state.pending.source,value:state.pending.card.value,power:state.pending.card.power} : null;
  return {
    selfId:viewer.id,phase:state.phase,capacity:state.capacity,round:state.round,currentPlayerId:current?.id||null,
    startingPlayerId:state.startingPlayerId,deckCount:state.deck.length,discardTop:state.discard.length?{value:state.discard.at(-1).value,power:state.discard.at(-1).power}:null,
    discardCount:state.discard.length,pendingCard:pendingForViewer,deadline:state.deadline,
    cabo:state.cabo?{callerId:state.cabo.callerId,remainingIds:[...state.cabo.remainingIds]}:null,
    privateReveal:state.privateReveal?.viewerId===viewer.id?{power:state.privateReveal.power,targetPlayerId:state.privateReveal.targetPlayerId,slotId:state.privateReveal.slotId,until:state.privateReveal.until}:null,
    targetNotice:state.targetNotice?.targetPlayerId===viewer.id?{id:state.targetNotice.id,type:state.targetNotice.type,actorId:state.targetNotice.actorId,targetSlotId:state.targetNotice.targetSlotId,until:state.targetNotice.until}:null,
    roundResult:state.roundResult.map((item)=>({...item})),winnerIds:[...state.winnerIds],logs:state.logs.map((entry)=>({...entry})),
    players:state.players.map((player)=>({id:player.id,name:player.name,isHost:player.isHost,connected:player.connected,score:player.score,lastRoundScore:player.lastRoundScore,resetUsed:player.resetUsed,hasInitialPeek:player.initialPeekIds.length===2,slots:player.slots.map((slot)=>visibleSlot(slot,viewer.id,player.id,state))})),
    permissions:{
      canManage:viewer.isHost,canKick:viewer.isHost,canSetCapacity:viewer.isHost&&state.phase==="lobby",
      canStart:viewer.isHost&&(state.phase==="lobby"||state.phase==="roundEnd"),canEnd:viewer.isHost&&state.phase!=="lobby",
      canInitialPeek:state.phase==="initialPeek"&&!viewer.initialPeekIds.length,
      canDraw:state.phase==="turn"&&current?.id===viewer.id,canCallCabo:state.phase==="turn"&&current?.id===viewer.id&&!state.cabo,
      canExchange:state.phase==="drawn"&&current?.id===viewer.id,canDiscard:state.phase==="drawn"&&current?.id===viewer.id&&state.pending?.source==="deck",
      canUsePower:state.phase==="drawn"&&current?.id===viewer.id&&state.pending?.source==="deck"&&Boolean(state.pending.card.power),
      canPlaceFailedExchange:state.phase==="failedExchange"&&current?.id===viewer.id,
      canCloseReveal:state.phase==="reveal"&&state.privateReveal?.viewerId===viewer.id
    }
  };
}

export function validateState(state) {
  const cards=[...state.deck,...state.discard,...state.players.flatMap((player)=>player.slots.map((slot)=>slot.card)),...(state.pending?[state.pending.card]:[])];
  const ids=cards.map((card)=>card.id);
  if (state.phase!=="lobby" && (cards.length!==52 || new Set(ids).size!==52)) throw new Error(`Card conservation failed: ${cards.length}/${new Set(ids).size}`);
  return true;
}

export function serializeState(state) { return structuredClone(state); }
export function restoreState(serializedState) {
  if (serializedState?.stateVersion!==STATE_VERSION) throw new Error(`Unsupported game13 state version: ${serializedState?.stateVersion}`);
  const state=structuredClone(serializedState); state.targetNotice??=null; validateState(state); return state;
}
