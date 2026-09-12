import { createRequire } from "node:module";
import { appendPresentationEvent, normalizePresentationState, validatePresentationState } from "../../shared/server/presentation-events.mjs";

const require = createRequire(import.meta.url);
const Engine = require("../rules.js");
const CARDS = require("../data/cards.json");
const CARD_BY_ID = Object.fromEntries(CARDS.map((card) => [card.id, card]));

export const ACTION_SECONDS = 0;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;

const PRESENTATION_PRIORITY = {"turn-start":1,"tokens-taken":2,"token-returned":2,"turn-passed":2,"mega-token-taken":2,"card-reserved":3,"secret-reserve":3,"secret-reserve-private":3.5,"card-captured":4,"pokemon-evolved":4,"final-round":4,"game-start":4,"game-result":5};

function normalizePresentation(state) {
  state.privatePresentationEvents = state.privatePresentationEvents && typeof state.privatePresentationEvents === "object" && !Array.isArray(state.privatePresentationEvents) ? state.privatePresentationEvents : {};
  normalizePresentationState(state);
  const latestPrivate = Object.values(state.privatePresentationEvents).flat().reduce((maximum,event) => Math.max(maximum,Number(event?.sequence) || 0),0);
  state.presentationSequence = Math.max(state.presentationSequence,latestPrivate);
  const latestScene = [...state.presentationEvents,...Object.values(state.privatePresentationEvents).flat()]
    .map((event) => /^pokemon_scene_(\d+)$/.exec(String(event?.sceneId || "")))
    .reduce((maximum,match) => Math.max(maximum,Number(match?.[1]) || 0),0);
  state.presentationSceneSequence = Number.isInteger(state.presentationSceneSequence) ? Math.max(state.presentationSceneSequence,latestScene) : latestScene;
}

function beginScene(state) {
  normalizePresentation(state);
  state.presentationSceneSequence += 1;
  return `pokemon_scene_${state.presentationSceneSequence}`;
}

function publicEvent(state,sceneId,event,now) {
  return appendPresentationEvent(state,{...event,sceneId,priority:PRESENTATION_PRIORITY[event.kind] || 1},{now,idPrefix:"pokemon_event",limit:60});
}

function privateEvent(state,playerId,sceneId,event,now) {
  const envelope={events:state.privatePresentationEvents[playerId] || [],sequence:state.presentationSequence};
  const stored=appendPresentationEvent(envelope,{...event,sceneId,private:true,priority:PRESENTATION_PRIORITY[event.kind] || 2},{now,eventsKey:"events",sequenceKey:"sequence",idPrefix:"pokemon_private",limit:24});
  state.privatePresentationEvents[playerId]=envelope.events;
  state.presentationSequence=envelope.sequence;
  return stored;
}

function validatePresentation(state) {
  validatePresentationState(state);
  const sequences=new Set(state.presentationEvents.map((event) => event.sequence));
  for (const events of Object.values(state.privatePresentationEvents)) {
    validatePresentationState({presentationEvents:events,presentationSequence:state.presentationSequence});
    for (const event of events) {
      if (!event.private || sequences.has(event.sequence)) throw new Error("Invalid game8 private presentation events");
      sequences.add(event.sequence);
    }
  }
  return true;
}

function cardLocation(game,cardId,seat) {
  for (const tier of ["rare","legend","stage3","stage2","stage1"]) {
    if (game.field?.[tier]?.includes(cardId)) return {source:"market",tier};
  }
  if (game.players?.[seat]?.reserve?.includes(cardId)) return {source:"reserve",tier:CARD_BY_ID[cardId]?.tier};
  return {source:"unknown",tier:CARD_BY_ID[cardId]?.tier};
}

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

function cleanName(value, fallback = "训练家") {
  return String(value ?? "").trim().slice(0, 12) || fallback;
}

function assertCapacity(capacity) {
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < MIN_PLAYERS || value > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", "游戏人数必须为 2～4 人。");
  }
  return value;
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanName(name, isHost ? "房主" : "训练家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected)
  };
}

function requireHost(state, actorId) {
  const player = state.players.find((item) => item.id === actorId);
  if (!player?.isHost) {
    throw new GameRuleError("host_required", "只有房主可以执行此操作。", 403);
  }
  return player;
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.game = null;
}

function staticGameData(game) {
  const restored = {
    ...game,
    cardDB: CARDS,
    byId: CARD_BY_ID,
    megaDB: [],
    pokemartDB: []
  };
  for (const player of restored.players || []) {
    player.reserveVisibility ||= {};
    for (const id of player.reserve || []) player.reserveVisibility[id] ||= "secret";
  }
  return restored;
}

function finishTurnWhenNoDecisionRemains(game, seat, actionType) {
  if (!game || game.phase === "gameover" || !game.acted) return;
  const pending = Engine.turnState(game);
  if (pending.mustDiscard > 0) return;
  const completedEvolution = actionType === "evolve" || actionType === "megaEvolve";
  const hasEvolutionChoice = pending.evolutions.length > 0 || pending.megaEvolutions.length > 0;
  if (!completedEvolution && hasEvolutionChoice) return;
  const ended = Engine.applyAction(game, { type: "endTurn" }, seat);
  if (!ended?.ok) throw new Error(`Unable to automatically end game8 turn: ${ended?.error || "unknown error"}`);
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true })],
    game: null,
    presentationEvents: [],
    privatePresentationEvents: {},
    presentationSequence: 0,
    presentationSceneSequence: 0
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") {
    throw new GameRuleError("game_started", "游戏已经开始，不能中途加入。", 409);
  }
  if (state.players.length >= state.capacity) {
    throw new GameRuleError("room_full", "房间人数已满。", 409);
  }
  if (state.players.some((item) => item.id === String(player.id))) {
    throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  }
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  if (state.phase !== "lobby") {
    throw new GameRuleError("game_started", "游戏开始后不能移出玩家。", 409);
  }
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  }
  state.players.splice(index, 1);
  return target;
}

export function canChangeSeats(state) {
  return state.phase === "lobby";
}

export function vacateSeat(state, playerId) {
  if (!canChangeSeats(state)) {
    throw new GameRuleError("seat_change_unavailable", "游戏开始后不能转入旁观席。", 409);
  }
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) {
    throw new GameRuleError("invalid_seat_target", "该训练家不能转入旁观席。", 403);
  }
  state.players.splice(index, 1);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = state.players.find((item) => item.id === String(playerId));
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  return true;
}

export function applyAction(state, actorId, action, { random = Math.random, now = Date.now() } = {}) {
  normalizePresentation(state);
  const type = action?.type;

  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") {
      throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    }
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) {
      throw new GameRuleError("capacity_too_small", "人数不能少于已经加入的玩家数。", 409);
    }
    state.capacity = capacity;
    return;
  }

  if (type === "start") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") {
      throw new GameRuleError("already_started", "游戏已经开始。", 409);
    }
    if (state.players.length !== state.capacity) {
      throw new GameRuleError("players_missing", `需要 ${state.capacity} 位训练家到齐。`, 409);
    }
    if (state.players.some((player) => !player.connected)) {
      throw new GameRuleError("players_offline", "请等待所有训练家恢复连接。", 409);
    }
    const seed = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 2 ** 31);
    state.game = Engine.createGame(CARDS, {
      numPlayers: state.capacity,
      names: state.players.map((player) => player.name),
      seed
    });
    state.phase = "playing";
    const sceneId=beginScene(state),first=state.players[state.game.turn];
    publicEvent(state,sceneId,{kind:"game-start",actorId:first.id,round:state.game.round,text:`训练家挑战开始，${first.name} 首先行动`},now);
    return;
  }

  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase !== "playing") {
      throw new GameRuleError("game_not_playing", "当前没有可结束的游戏。", 409);
    }
    resetToLobby(state);
    return;
  }

  if (type === "restart") {
    requireHost(state, actorId);
    if (state.phase !== "ended") {
      throw new GameRuleError("game_not_ended", "只有结算后才能返回大厅。", 409);
    }
    resetToLobby(state);
    return;
  }

  if (state.phase !== "playing" || !state.game) {
    throw new GameRuleError("game_not_playing", "游戏当前不在进行中。", 409);
  }
  const seat = state.players.findIndex((player) => player.id === String(actorId));
  if (seat < 0) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  if (!type) throw new GameRuleError("unknown_action", "无法识别该操作。");
  const actor=state.players[seat];
  const beforeTurn=state.game.turn;
  const beforeLastRound=Boolean(state.game.lastRound);
  const location=action.cardId ? cardLocation(state.game,action.cardId,seat) : null;
  const beforePurple=state.game.players[seat].tokens.purple;
  const result = Engine.applyAction(state.game, action, seat);
  if (!result?.ok) {
    throw new GameRuleError("invalid_game_action", result?.error || "当前操作不合法。", 409);
  }
  if (type !== "endTurn") finishTurnWhenNoDecisionRemains(state.game, seat, type);
  const sceneId=beginScene(state);
  if (type === "take") publicEvent(state,sceneId,{kind:"tokens-taken",actorId:actor.id,colors:[...action.colors],text:`${actor.name} 拿取 ${action.colors.map((color) => Engine.zhBall(color)).join("、")}`},now);
  else if (type === "reserve") {
    const gotMaster=state.game.players[seat].tokens.purple > beforePurple;
    if (action.target?.fromDeck) {
      const tier=String(action.target.fromDeck);
      publicEvent(state,sceneId,{kind:"secret-reserve",actorId:actor.id,tier,gotMaster,text:`${actor.name} 从${Engine.zhTier(tier)}牌堆暗中保留一张牌${gotMaster ? "，并获得大师球" : ""}`},now);
      privateEvent(state,actor.id,sceneId,{kind:"secret-reserve-private",actorId:actor.id,tier,cardId:result.cardId,cardName:CARD_BY_ID[result.cardId]?.name || "未知宝可梦",gotMaster,text:`你暗中保留了 ${CARD_BY_ID[result.cardId]?.name || "一张宝可梦"}${gotMaster ? "，并获得大师球" : ""}`},now);
    } else {
      const cardId=result.cardId;
      publicEvent(state,sceneId,{kind:"card-reserved",actorId:actor.id,cardId,cardName:CARD_BY_ID[cardId]?.name || "宝可梦",tier:CARD_BY_ID[cardId]?.tier,gotMaster,text:`${actor.name} 保留了 ${CARD_BY_ID[cardId]?.name || "一张宝可梦"}${gotMaster ? "，并获得大师球" : ""}`},now);
    }
  } else if (type === "capture") {
    const card=CARD_BY_ID[action.cardId];
    publicEvent(state,sceneId,{kind:"card-captured",actorId:actor.id,cardId:action.cardId,cardName:card?.name || "宝可梦",tier:location?.tier,source:location?.source,text:`${actor.name} 捕捉了 ${card?.name || "一只宝可梦"}`},now);
  } else if (type === "evolve" || type === "megaEvolve") {
    const fromId=result.fromId || action.fromId,toId=result.toId || result.megaId || action.toId || action.megaId;
    publicEvent(state,sceneId,{kind:"pokemon-evolved",actorId:actor.id,fromId,toId,fromName:CARD_BY_ID[fromId]?.name || "原形态",toName:CARD_BY_ID[toId]?.name || "新形态",text:`${actor.name} 将 ${CARD_BY_ID[fromId]?.name || "宝可梦"} 进化为 ${CARD_BY_ID[toId]?.name || "新形态"}`},now);
  } else if (type === "discard") publicEvent(state,sceneId,{kind:"token-returned",actorId:actor.id,color:action.color,text:`${actor.name} 归还 1 个${Engine.zhBall(action.color)}`},now);
  else if (type === "takeMega") publicEvent(state,sceneId,{kind:"mega-token-taken",actorId:actor.id,text:`${actor.name} 获得 1 个 Mega 代币`},now);
  else if (type === "pass") publicEvent(state,sceneId,{kind:"turn-passed",actorId:actor.id,text:`${actor.name} 无法行动，跳过回合`},now);
  let transitionScene=sceneId;
  if (!beforeLastRound && state.game.lastRound) {
    transitionScene=beginScene(state);
    publicEvent(state,transitionScene,{kind:"final-round",actorId:actor.id,text:`${actor.name} 达成胜利条件，进入最后一轮`},now);
  }
  if (state.game.phase === "gameover") {
    state.phase = "ended";
    const resultScene=beginScene(state),winnerSeat=state.game.winner,winner=state.players[winnerSeat];
    publicEvent(state,resultScene,{kind:"game-result",actorId:winner?.id || null,winnerId:winner?.id || null,text:`游戏结束，${winner?.name || "训练家"} 获胜`},now);
  } else if (state.game.turn !== beforeTurn) {
    const next=state.players[state.game.turn];
    publicEvent(state,transitionScene,{kind:"turn-start",actorId:next.id,text:`轮到 ${next.name} 行动`},now);
  }
}

export function handleTimeout() {
  return false;
}

export function getDeadline() {
  return 0;
}

function buildPublicView(state, { viewer = null, seat = -1, permissions } = {}) {
  normalizePresentation(state);
  const game = state.game ? Engine.redactFor(state.game, seat) : null;
  if (game && !viewer) game.viewerId = null;
  return {
    selfId: viewer?.id ?? null,
    viewerId: viewer?.id ?? null,
    phase: state.phase,
    capacity: state.capacity,
    players: state.players.map((player) => ({ ...player })),
    game,
    presentationEvents:[...state.presentationEvents,...(viewer ? state.privatePresentationEvents[viewer.id] || [] : [])].sort((left,right) => left.sequence-right.sequence).map((event) => structuredClone(event)),
    permissions
  };
}

export function buildView(state, viewerId) {
  const seat = state.players.findIndex((player) => player.id === String(viewerId));
  const viewer = state.players[seat];
  if (!viewer) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  return buildPublicView(state, {
    viewer,
    seat,
    permissions: {
      canManage: viewer.isHost,
      canKick: viewer.isHost && state.phase === "lobby",
      canStart: viewer.isHost && state.phase === "lobby",
      canEnd: viewer.isHost && state.phase === "playing",
      canRestart: viewer.isHost && state.phase === "ended"
    }
  });
}

export function buildSpectatorView(state) {
  return buildPublicView(state, {
    seat: -1,
    permissions: {
      canManage: false,
      canKick: false,
      canStart: false,
      canEnd: false,
      canRestart: false
    }
  });
}

export function serializeState(state) {
  normalizePresentation(state);
  validatePresentation(state);
  const serialized = structuredClone({ ...state, game: null });
  if (!state.game) return serialized;
  const { cardDB, byId, megaDB, pokemartDB, ...dynamic } = state.game;
  serialized.game = structuredClone(dynamic);
  return serialized;
}

export function restoreState(serializedState) {
  const state = structuredClone(serializedState);
  if (state.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game8 state version ${state.stateVersion}`);
  }
  if (state.game) state.game = staticGameData(state.game);
  normalizePresentation(state);
  validatePresentation(state);
  return state;
}

export const cardDatabase = CARDS;
