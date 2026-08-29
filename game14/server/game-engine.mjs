import {
  ACTION_SECONDS,
  CARD_LABELS,
  CARD_TYPES,
  HAND_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REVEAL_SECONDS,
  actionCardCount,
  createActionDeck,
  pigsPerPlayer,
  shuffle
} from "../rules.mjs";

export { ACTION_SECONDS };
export const STATE_VERSION = 2;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    this.status = status;
  }
}

const cleanText = (value, fallback = "玩家") => String(value ?? "").trim().slice(0, 12) || fallback;
const playerById = (state, id) => state.players.find((player) => player.id === String(id)) || null;
const pigById = (player, id) => player?.pigs.find((pig) => pig.id === String(id)) || null;
const currentPlayer = (state) => state.players[state.currentIndex] || null;

function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new GameRuleError("invalid_capacity", `游戏人数必须为 ${MIN_PLAYERS}～${MAX_PLAYERS} 人。`);
  }
  return capacity;
}

function requireActor(state, id) {
  const actor = playerById(state, id);
  if (!actor) throw new GameRuleError("not_a_player", "你不属于这个房间。", 403);
  return actor;
}

function requireHost(state, id) {
  const actor = requireActor(state, id);
  if (!actor.isHost) throw new GameRuleError("host_required", "只有房主可以执行这个操作。", 403);
  return actor;
}

function requireCurrent(state, actor) {
  if (currentPlayer(state)?.id !== actor.id) {
    throw new GameRuleError("not_your_turn", "现在还没有轮到你。", 409);
  }
}

function makePlayer({ id, name, isHost = false, connected = false }) {
  if (!id) throw new GameRuleError("player_id_required", "缺少玩家身份。");
  return {
    id: String(id),
    name: cleanText(name, isHost ? "房主" : "玩家"),
    isHost: Boolean(isHost),
    connected: Boolean(connected),
    hand: [],
    pigs: []
  };
}

function addLog(state, text, now) {
  state.logs.unshift({ id: `log_${state.logSequence += 1}`, text, at: now });
  if (state.logs.length > 100) state.logs.length = 100;
}

function setDeadline(state, now) {
  state.deadline = now + ACTION_SECONDS * 1000;
}

function makePigs(player, count) {
  player.pigs = Array.from({ length: count }, (_, index) => ({
    id: `${player.id}_pig_${index + 1}`,
    dirty: false,
    barn: null,
    door: null,
    rod: null
  }));
}

function recycleDiscard(state, random) {
  if (state.deck.length || !state.discard.length) return;
  state.deck = shuffle(state.discard, random);
  state.discard = [];
}

function drawCard(state, random) {
  recycleDiscard(state, random);
  const card = state.deck.pop();
  if (!card) throw new GameRuleError("deck_empty", "没有可以抽取的行动牌。", 409);
  return card;
}

function targetKey(playerId, pigId) {
  return `${playerId}:${pigId}`;
}

function legalTargets(state, actor, type) {
  const targets = [];
  const add = (player, pig) => targets.push({
    key: targetKey(player.id, pig.id),
    playerId: player.id,
    pigId: pig.id
  });

  if (type === CARD_TYPES.MUD) {
    for (const pig of actor.pigs) if (!pig.dirty) add(actor, pig);
  } else if (type === CARD_TYPES.BARN) {
    for (const pig of actor.pigs) if (!pig.barn) add(actor, pig);
  } else if (type === CARD_TYPES.ROD) {
    for (const pig of actor.pigs) if (pig.barn && !pig.rod) add(actor, pig);
  } else if (type === CARD_TYPES.DOOR) {
    for (const pig of actor.pigs) if (pig.dirty && pig.barn && !pig.door) add(actor, pig);
  } else if (type === CARD_TYPES.FARMER) {
    for (const player of state.players) {
      if (player.id === actor.id) continue;
      for (const pig of player.pigs) if (pig.dirty && !pig.door) add(player, pig);
    }
  } else if (type === CARD_TYPES.LIGHTNING) {
    for (const player of state.players) {
      if (player.id === actor.id) continue;
      for (const pig of player.pigs) if (pig.barn && !pig.rod) add(player, pig);
    }
  }
  return targets;
}

function cardCanPlay(state, actor, card) {
  if (card.type === CARD_TYPES.RAIN) return true;
  return legalTargets(state, actor, card.type).length > 0;
}

function canExchangeHand(state, actor) {
  return actor.hand.length === HAND_SIZE && actor.hand.every((card) => !cardCanPlay(state, actor, card));
}

function removeHandCard(actor, cardId) {
  const index = actor.hand.findIndex((card) => card.id === String(cardId));
  if (index < 0) throw new GameRuleError("card_not_owned", "这张牌不在你的手中。", 409);
  return actor.hand.splice(index, 1)[0];
}

function findTarget(state, action) {
  const player = playerById(state, action.targetPlayerId);
  const pig = pigById(player, action.targetPigId);
  return player && pig ? { player, pig } : null;
}

function assertTarget(state, actor, card, action) {
  const allowed = new Set(legalTargets(state, actor, card.type).map((target) => target.key));
  const target = findTarget(state, action);
  if (!target || !allowed.has(targetKey(target.player.id, target.pig.id))) {
    throw new GameRuleError("invalid_target", "这张牌不能作用于所选小猪。", 409);
  }
  return target;
}

function hasWon(player) {
  return player.pigs.length > 0 && player.pigs.every((pig) => pig.dirty);
}

function finishGame(state, winner, now) {
  state.phase = "ended";
  state.winnerId = winner.id;
  state.deadline = 0;
  addLog(state, `${winner.name} 的所有小猪都变脏了，获得本局胜利！`, now);
}

function finishTurn(state, actor, now, random) {
  if (hasWon(actor)) return finishGame(state, actor, now);
  actor.hand.push(drawCard(state, random));
  state.currentIndex = (state.currentIndex + 1) % state.players.length;
  setDeadline(state, now);
}

function playCard(state, actor, action, now, random) {
  const card = actor.hand.find((item) => item.id === String(action.cardId));
  if (!card) throw new GameRuleError("card_not_owned", "这张牌不在你的手中。", 409);
  if (!cardCanPlay(state, actor, card)) {
    throw new GameRuleError("card_not_playable", "这张牌当前没有可以执行的合法效果；你可以将它直接弃掉。", 409);
  }

  let target = null;
  if (card.type !== CARD_TYPES.RAIN) target = assertTarget(state, actor, card, action);
  removeHandCard(actor, card.id);

  if (card.type === CARD_TYPES.MUD) {
    target.pig.dirty = true;
    state.discard.push(card);
    addLog(state, `${actor.name} 让自己的一只小猪跳进泥巴，变成了脏小猪。`, now);
  } else if (card.type === CARD_TYPES.RAIN) {
    let washed = 0;
    for (const player of state.players) {
      for (const pig of player.pigs) {
        if (pig.dirty && !pig.barn) {
          pig.dirty = false;
          washed += 1;
        }
      }
    }
    state.discard.push(card);
    addLog(state, `${actor.name} 召来一场大雨，洗干净了 ${washed} 只露天脏猪。`, now);
  } else if (card.type === CARD_TYPES.BARN) {
    target.pig.barn = card;
    addLog(state, `${actor.name} 给自己的一只小猪盖了猪舍。`, now);
  } else if (card.type === CARD_TYPES.ROD) {
    target.pig.rod = card;
    addLog(state, `${actor.name} 给一座猪舍装上了避雷针。`, now);
  } else if (card.type === CARD_TYPES.DOOR) {
    target.pig.door = card;
    addLog(state, `${actor.name} 把一座脏猪猪舍的门封了起来。`, now);
  } else if (card.type === CARD_TYPES.FARMER) {
    target.pig.dirty = false;
    state.discard.push(card);
    addLog(state, `${actor.name} 派农夫把 ${target.player.name} 的一只脏猪洗干净了。`, now);
  } else if (card.type === CARD_TYPES.LIGHTNING) {
    state.discard.push(card, target.pig.barn);
    if (target.pig.door) state.discard.push(target.pig.door);
    target.pig.barn = null;
    target.pig.door = null;
    addLog(state, `${actor.name} 用闪电摧毁了 ${target.player.name} 的一座猪舍。`, now);
  }

  finishTurn(state, actor, now, random);
}

function discardCard(state, actor, action, now, random, timeout = false) {
  const card = removeHandCard(actor, action.cardId);
  state.discard.push(card);
  addLog(state, `${actor.name}${timeout ? "行动超时，系统替其" : "选择不发动效果，"}弃掉了一张${CARD_LABELS[card.type]}牌。`, now);
  finishTurn(state, actor, now, random);
}

function exchangeHand(state, actor, now, random) {
  if (!canExchangeHand(state, actor)) {
    throw new GameRuleError("exchange_not_allowed", "只有三张手牌都无法合法使用时，才能公开并全部更换。", 409);
  }
  const shown = actor.hand.map((card) => ({ id: card.id, type: card.type }));
  state.discard.push(...actor.hand);
  actor.hand = [];
  state.revealedExchange = {
    playerId: actor.id,
    cards: shown,
    until: now + REVEAL_SECONDS * 1000
  };
  while (actor.hand.length < HAND_SIZE) actor.hand.push(drawCard(state, random));
  addLog(state, `${actor.name} 公开了三张无法使用的手牌，并将它们全部更换。`, now);
  state.currentIndex = (state.currentIndex + 1) % state.players.length;
  setDeadline(state, now);
}

function resetToLobby(state) {
  state.phase = "lobby";
  state.deck = [];
  state.discard = [];
  state.currentIndex = 0;
  state.deadline = 0;
  state.winnerId = null;
  state.revealedExchange = null;
  state.logs = [];
  state.logSequence = 0;
  for (const player of state.players) {
    player.hand = [];
    player.pigs = [];
  }
}

function beginGame(state, now, random) {
  const pigCount = pigsPerPlayer(state.players.length);
  state.phase = "playing";
  state.deck = createActionDeck(random, state.players.length);
  state.discard = [];
  state.winnerId = null;
  state.revealedExchange = null;
  state.logs = [];
  state.logSequence = 0;
  for (const player of state.players) {
    player.hand = [];
    makePigs(player, pigCount);
  }
  for (let count = 0; count < HAND_SIZE; count += 1) {
    for (const player of state.players) player.hand.push(drawCard(state, random));
  }
  state.currentIndex = Math.floor(random() * state.players.length);
  setDeadline(state, now);
  addLog(state, `游戏开始，每位玩家拥有 ${pigCount} 只干净小猪，${currentPlayer(state).name} 先行动。`, now);
}

export function createLobby({ capacity, host }) {
  return {
    stateVersion: STATE_VERSION,
    phase: "lobby",
    capacity: assertCapacity(capacity),
    players: [makePlayer({ ...host, isHost: true })],
    deck: [],
    discard: [],
    currentIndex: 0,
    deadline: 0,
    winnerId: null,
    revealedExchange: null,
    logs: [],
    logSequence: 0
  };
}

export function addPlayer(state, player) {
  if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能中途加入。", 409);
  if (state.players.length >= state.capacity) throw new GameRuleError("room_full", "房间人数已满。", 409);
  if (playerById(state, player.id)) throw new GameRuleError("player_exists", "该玩家已经在房间中。", 409);
  const next = makePlayer(player);
  state.players.push(next);
  return next;
}

export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId);
  const index = state.players.findIndex((player) => player.id === String(playerId));
  const target = state.players[index];
  if (!target || target.isHost) throw new GameRuleError("invalid_kick_target", "无法移出该玩家。");
  state.players.splice(index, 1);
  if (state.phase !== "lobby") resetToLobby(state);
  return target;
}

export function setPresence(state, playerId, connected) {
  const player = playerById(state, playerId);
  if (!player || player.connected === Boolean(connected)) return false;
  player.connected = Boolean(connected);
  return true;
}

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const actor = requireActor(state, actorId);
  const type = action?.type;

  if (type === "setCapacity") {
    requireHost(state, actorId);
    if (state.phase !== "lobby") throw new GameRuleError("game_started", "游戏开始后不能修改人数。", 409);
    const capacity = assertCapacity(action.capacity);
    if (capacity < state.players.length) throw new GameRuleError("capacity_too_small", "人数不能少于已加入的玩家数。", 409);
    state.capacity = capacity;
    return;
  }
  if (type === "start" || type === "restart") {
    requireHost(state, actorId);
    if (type === "start" && state.phase !== "lobby") throw new GameRuleError("already_started", "游戏已经开始。", 409);
    if (type === "restart" && state.phase !== "ended") throw new GameRuleError("restart_unavailable", "当前不能重新开始。", 409);
    if (state.players.length !== state.capacity) throw new GameRuleError("players_missing", `需要 ${state.capacity} 人到齐。`, 409);
    if (state.players.some((player) => !player.connected)) throw new GameRuleError("players_offline", "所有玩家在线后才能开始。", 409);
    return beginGame(state, now, random);
  }
  if (type === "end") {
    requireHost(state, actorId);
    if (state.phase === "lobby") throw new GameRuleError("game_not_started", "当前没有可结束的游戏。", 409);
    return resetToLobby(state);
  }

  if (state.phase !== "playing") throw new GameRuleError("action_unavailable", "当前不能执行游戏行动。", 409);
  if (!actor.connected) throw new GameRuleError("not_connected", "重新连接房间后才能行动。", 409);
  requireCurrent(state, actor);
  state.revealedExchange = null;

  if (type === "playCard") return playCard(state, actor, action, now, random);
  if (type === "discardCard") return discardCard(state, actor, action, now, random);
  if (type === "exchangeHand") return exchangeHand(state, actor, now, random);
  throw new GameRuleError("unknown_action", "无法识别这个回合操作。");
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (state.phase !== "playing" || !state.deadline || now < state.deadline) return false;
  const actor = currentPlayer(state);
  if (!actor?.hand.length) return false;
  state.revealedExchange = null;
  discardCard(state, actor, { cardId: actor.hand[0].id }, now, random, true);
  return true;
}

export function getDeadline(state) {
  return Number(state.deadline) || 0;
}

function publicPig(pig) {
  return {
    id: pig.id,
    dirty: pig.dirty,
    hasBarn: Boolean(pig.barn),
    hasDoor: Boolean(pig.door),
    hasRod: Boolean(pig.rod),
    completelySafe: Boolean(pig.dirty && pig.barn && pig.door && pig.rod)
  };
}

export function buildView(state, viewerId) {
  const viewer = requireActor(state, viewerId);
  const current = currentPlayer(state);
  const myTurn = state.phase === "playing" && current?.id === viewer.id;
  return {
    selfId: viewer.id,
    phase: state.phase,
    capacity: state.capacity,
    currentPlayerId: current?.id || null,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    discardTop: state.discard.length ? { type: state.discard.at(-1).type } : null,
    deadline: state.deadline,
    winnerId: state.winnerId,
    revealedExchange: state.revealedExchange ? structuredClone(state.revealedExchange) : null,
    logs: state.logs.map((entry) => ({ ...entry })),
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      handCount: player.hand.length,
      pigs: player.pigs.map(publicPig)
    })),
    hand: viewer.hand.map((card) => ({
      id: card.id,
      type: card.type,
      label: CARD_LABELS[card.type],
      playable: myTurn && cardCanPlay(state, viewer, card),
      legalTargets: myTurn ? legalTargets(state, viewer, card.type) : []
    })),
    permissions: {
      canManage: viewer.isHost,
      canKick: viewer.isHost,
      canSetCapacity: viewer.isHost && state.phase === "lobby",
      canStart: viewer.isHost && state.phase === "lobby",
      canEnd: viewer.isHost && state.phase !== "lobby",
      canRestart: viewer.isHost && state.phase === "ended",
      canAct: myTurn,
      canExchange: myTurn && canExchangeHand(state, viewer)
    }
  };
}

export function validateState(state) {
  if (!state || !Array.isArray(state.players)) throw new Error("Invalid game14 state");
  if (state.phase === "lobby") return true;
  const actionCards = [
    ...state.deck,
    ...state.discard,
    ...state.players.flatMap((player) => [
      ...player.hand,
      ...player.pigs.flatMap((pig) => [pig.barn, pig.door, pig.rod].filter(Boolean))
    ])
  ];
  const ids = actionCards.map((card) => card.id);
  const expectedCards = actionCardCount(state.players.length);
  if (actionCards.length !== expectedCards || new Set(ids).size !== expectedCards) {
    throw new Error(`Action card conservation failed: ${actionCards.length}/${new Set(ids).size}`);
  }
  const expectedPigs = pigsPerPlayer(state.players.length);
  if (state.players.some((player) => player.pigs.length !== expectedPigs)) throw new Error("Pig count mismatch");
  return true;
}

export function serializeState(state) {
  validateState(state);
  return structuredClone(state);
}

export function restoreState(serializedState) {
  if (serializedState?.stateVersion !== STATE_VERSION) {
    throw new Error(`Unsupported game14 state version: ${serializedState?.stateVersion}`);
  }
  const state = structuredClone(serializedState);
  state.revealedExchange ??= null;
  validateState(state);
  return state;
}
