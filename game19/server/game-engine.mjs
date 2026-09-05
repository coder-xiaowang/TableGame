import {
  CARD_META, CHARACTERS, MAX_PLAYERS, MIN_PLAYERS, ROLES, ROLE_DISTRIBUTION,
  cardName, createDeck, isBarrelSuccess, isDynamiteHit, isJailSuccess, isRed, shuffle
} from "../rules.mjs";

export const STATE_VERSION = 1;
export const SUPPORTS_SPECTATORS = true;
export const TURN_SECONDS = 75;
export const ACTION_SECONDS = TURN_SECONDS;
export const RESPONSE_SECONDS = 15;
export const CHOICE_SECONDS = 20;
export const DISCARD_SECONDS = 25;

export class GameRuleError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = "GameRuleError"; this.code = code; this.status = status;
  }
}

const clone = (value) => structuredClone(value);
const cleanName = (value, fallback = "玩家") => String(value ?? "").trim().slice(0, 12) || fallback;
const byId = (state, id) => state.players.find((player) => player.id === String(id)) || null;
const alive = (state) => state.players.filter((player) => player.alive);
const current = (state) => state.players[state.currentIndex] || null;
const character = (player) => CHARACTERS.find((item) => item.id === player.characterId);
const hasCharacter = (player, id) => player?.characterId === id;
const equipment = (player, slot) => player.equipment.find((card) => CARD_META[card.type]?.equipment === slot) || null;
const randomItem = (values, random) => values[Math.min(values.length - 1, Math.floor(random() * values.length))];

function fail(condition, code, message, status) { if (condition) throw new GameRuleError(code, message, status); }
function log(state, text, now) {
  state.logs.unshift({ id: `log_${state.logSequence += 1}`, text, at: now });
  if (state.logs.length > 180) state.logs.length = 180;
}
function newPending(state, data) { return { ...data, id: `effect_${state.effectSequence += 1}` }; }
function setPhase(state, phase, now, seconds = 0) {
  state.phase = phase; state.deadline = seconds ? now + seconds * 1000 : 0;
}
function requireActor(state, id) {
  const actor = byId(state, id); fail(!actor, "not_a_player", "你不在玩家席中。", 403); return actor;
}
function requireHost(state, id) {
  const actor = requireActor(state, id); fail(!actor.isHost, "host_required", "只有房主可以执行该操作。", 403); return actor;
}
function assertCapacity(value) {
  const capacity = Number(value);
  fail(!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS, "invalid_capacity", "人数必须为4至7人。");
  return capacity;
}
function makePlayer({ id, name, isHost = false, connected = false }) {
  fail(!id, "player_id_required", "缺少玩家身份。");
  return { id: String(id), name: cleanName(name, isHost ? "房主" : "玩家"), isHost: Boolean(isHost), connected: Boolean(connected), alive: true, role: null, characterId: null, life: 0, maxLife: 0, hand: [], equipment: [], bangPlayed: 0 };
}

function removeCard(player, cardId) {
  const index = player.hand.findIndex((card) => card.id === String(cardId));
  fail(index < 0, "card_not_owned", "这张牌不在你的手中。", 409);
  return player.hand.splice(index, 1)[0];
}
function drawOne(state, random) {
  if (!state.deck.length && state.discard.length > 1) {
    const top = state.discard.pop();
    state.deck = shuffle(state.discard.splice(0), random);
    state.discard.push(top);
  }
  return state.deck.pop() || null;
}
function drawCards(state, player, count, random) {
  for (let index = 0; index < count; index += 1) {
    const card = drawOne(state, random); if (!card) break; player.hand.push(card);
  }
  ensureSuzy(state, player, random);
}
function discard(state, card) { if (card) state.discard.push(card); }
function discardAll(state, player) { state.discard.push(...player.hand.splice(0), ...player.equipment.splice(0)); }
function ensureSuzy(state, player, random) {
  if (player?.alive && hasCharacter(player, "suzy_lafayette") && player.hand.length === 0) {
    const card = drawOne(state, random); if (card) player.hand.push(card);
  }
}

function livingDistance(state, fromId, toId) {
  const seats = alive(state); const from = seats.findIndex((player) => player.id === fromId); const to = seats.findIndex((player) => player.id === toId);
  if (from < 0 || to < 0 || from === to) return 0;
  let distance = Math.min((to - from + seats.length) % seats.length, (from - to + seats.length) % seats.length);
  const source = seats[from], target = seats[to];
  if (equipment(source, "scope") || hasCharacter(source, "rose_doolan")) distance -= 1;
  if (equipment(target, "mustang") || hasCharacter(target, "paul_regret")) distance += 1;
  return Math.max(1, distance);
}
function weaponRange(player) { return Number(equipment(player, "weapon") ? CARD_META[equipment(player, "weapon").type].range : 1); }
function canBang(state, actor, target) { return target?.alive && target.id !== actor.id && livingDistance(state, actor.id, target.id) <= weaponRange(actor); }
function canTouch(state, actor, target, panic = false) { return target?.alive && target.id !== actor.id && (target.hand.length + target.equipment.length > 0) && (!panic || livingDistance(state, actor.id, target.id) <= 1); }

function findNextAliveIndex(state, fromIndex = state.currentIndex) {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (fromIndex + step) % state.players.length;
    if (state.players[index].alive) return index;
  }
  return -1;
}
function matchWinner(state) {
  const living = alive(state); const sheriff = state.players.find((player) => player.role === ROLES.SHERIFF);
  if (!sheriff?.alive) {
    if (living.length === 1 && living[0].role === ROLES.RENEGADE) return { side: "renegade", winnerIds: [living[0].id], text: `${living[0].name} 以叛徒身份独自存活！` };
    return { side: "outlaw", winnerIds: state.players.filter((player) => player.role === ROLES.OUTLAW).map((player) => player.id), text: "警长倒下，歹徒阵营获胜！" };
  }
  if (!living.some((player) => [ROLES.OUTLAW, ROLES.RENEGADE].includes(player.role))) {
    return { side: "law", winnerIds: state.players.filter((player) => [ROLES.SHERIFF, ROLES.DEPUTY].includes(player.role)).map((player) => player.id), text: "所有歹徒与叛徒均已出局，警长阵营获胜！" };
  }
  return null;
}
function finishMatch(state, result, now) {
  state.winner = result; state.pending = null; setPhase(state, "ended", now); log(state, result.text, now);
}
function finalizeElimination(state, victim, killer, orderedIds, now, random, resume) {
  const vulture = alive(state).find((player) => hasCharacter(player, "vulture_sam"));
  if (vulture) vulture.hand.push(...victim.hand.splice(0), ...victim.equipment.splice(0)); else discardAll(state, victim);
  if (victim.role === ROLES.OUTLAW && killer?.alive) drawCards(state, killer, 3, random);
  if (killer?.role === ROLES.SHERIFF && victim.role === ROLES.DEPUTY) { discardAll(state, killer); ensureSuzy(state, killer, random); }
  log(state, `${victim.name} 出局，身份是${ROLE_META_LABEL(victim.role)}。`, now);
  const winner = matchWinner(state); if (winner) finishMatch(state, winner, now);
  else resumeFlow(state, resume, now, random);
}
function beginElimination(state, victim, killer, now, random, resume) {
  victim.alive = false; victim.life = 0;
  const vulture = alive(state).find((player) => hasCharacter(player, "vulture_sam"));
  const cards = [...victim.hand, ...victim.equipment];
  if (!vulture && cards.length > 1) {
    state.pending = newPending(state, { type: "eliminationDiscard", actorId: victim.id, killerId: killer?.id || null, cardIds: cards.map((card) => card.id), resume });
    setPhase(state, "eliminationDiscard", now, CHOICE_SECONDS); return;
  }
  finalizeElimination(state, victim, killer, cards.map((card) => card.id), now, random, resume);
}
function resolveEliminationOrder(state, actor, action, now, random) {
  const pending = state.pending; fail(pending?.actorId !== actor.id, "not_eliminated_player", "现在不需要你整理弃牌。");
  const ids = (action.cardIds || []).map(String), expected = pending.cardIds;
  fail(ids.length !== expected.length || new Set(ids).size !== expected.length || expected.some((id) => !ids.includes(id)), "invalid_discard_order", "弃牌顺序必须包含你的全部手牌和装备。");
  const all = [...actor.hand, ...actor.equipment], ordered = ids.map((id) => all.find((card) => card.id === id));
  actor.hand = []; actor.equipment = []; state.discard.push(...ordered);
  const killer = byId(state, pending.killerId), resume = pending.resume;
  if (actor.role === ROLES.OUTLAW && killer?.alive) drawCards(state, killer, 3, random);
  if (killer?.role === ROLES.SHERIFF && actor.role === ROLES.DEPUTY) { discardAll(state, killer); ensureSuzy(state, killer, random); }
  log(state, `${actor.name} 出局，身份是${ROLE_META_LABEL(actor.role)}。`, now);
  const winner = matchWinner(state); if (winner) finishMatch(state, winner, now); else resumeFlow(state, resume, now, random);
}
function ROLE_META_LABEL(role) { return ({ sheriff: "警长", deputy: "副警长", outlaw: "歹徒", renegade: "叛徒" })[role] || role; }

function applyDamage(state, target, amount, source, now, random, resume = null) {
  target.life -= amount;
  if (hasCharacter(target, "bart_cassidy")) drawCards(state, target, amount, random);
  if (hasCharacter(target, "el_gringo") && source?.hand.length) target.hand.push(source.hand.splice(Math.floor(random() * source.hand.length), 1)[0]);
  log(state, `${target.name} 失去${amount}点生命（剩余${Math.max(0, target.life)}）。`, now);
  if (target.life <= 0) {
    state.pending = newPending(state, { type: "dying", actorId: target.id, sourceId: source?.id || null, resume });
    setPhase(state, "dying", now, RESPONSE_SECONDS);
  } else resumeFlow(state, resume, now, random);
}
function heal(player, amount = 1) { player.life = Math.min(player.maxLife, player.life + amount); }

function resumeFlow(state, resume, now, random) {
  if (state.phase === "ended") return;
  if (!resume || resume.type === "play") {
    const actor = byId(state, resume?.actorId || current(state)?.id);
    return actor?.alive ? enterPlay(state, actor.id, now) : nextTurn(state, now, random);
  }
  if (resume.type === "multi") return continueMulti(state, resume, now, random);
  if (resume.type === "duel") return continueDuel(state, resume, now);
  if (resume.type === "turnStart") return continueTurnStart(state, resume.playerId, now, random);
}

function beginJudgment(state, owner, purpose, context, now, random) {
  const count = hasCharacter(owner, "lucky_duke") ? 2 : 1;
  const cards = []; for (let i = 0; i < count; i += 1) { const card = drawOne(state, random); if (card) cards.push(card); }
  if (cards.length > 1) {
    state.pending = newPending(state, { type: "judgmentChoice", actorId: owner.id, purpose, cards, context });
    setPhase(state, "judgmentChoice", now, CHOICE_SECONDS); return;
  }
  finishJudgment(state, owner, purpose, cards, cards[0]?.id, context, now, random);
}
function finishJudgment(state, owner, purpose, cards, cardId, context, now, random) {
  const chosen = cards.find((card) => card.id === String(cardId)); fail(!chosen, "invalid_judgment_card", "请选择一张判定牌。");
  for (const card of cards) discard(state, card);
  log(state, `${owner.name} 的${purpose === "dynamite" ? "炸药" : purpose === "jail" ? "监狱" : "木桶"}判定为 ${chosen?.rank || "?"}${chosen ? ({spades:"♠",hearts:"♥",clubs:"♣",diamonds:"♦"})[chosen.suit] : ""}。`, now);
  if (purpose === "dynamite") {
    if (isDynamiteHit(chosen)) { discard(state, context.delayedCard); return applyDamage(state, owner, 3, null, now, random, { type: "turnStart", playerId: owner.id }); }
    const next = state.players[findNextAliveIndex(state, state.players.indexOf(owner))];
    if (equipment(next, "dynamite")) discard(state, context.delayedCard); else next.equipment.push(context.delayedCard);
    return continueTurnStart(state, owner.id, now, random);
  }
  if (purpose === "jail") {
    if (!isJailSuccess(chosen)) { log(state, `${owner.name} 未能越狱，本回合跳过。`, now); return nextTurn(state, now, random); }
    return beginDraw(state, owner, now, random);
  }
  const defense = context.defense; state.pending = newPending(state, { ...defense, id: undefined });
  if (isBarrelSuccess(chosen)) {
    defense.played += 1;
    if (defense.played >= defense.needed) { const resume = defense.resume; if (resume?.type === "play") finishPlayedCard(state, defense.card); return resumeFlow(state, resume, now, random); }
  }
  setPhase(state, "defense", now, RESPONSE_SECONDS);
}
function continueTurnStart(state, playerId, now, random) {
  const actor = byId(state, playerId); if (!actor?.alive) return nextTurn(state, now, random);
  const dynamite = equipment(actor, "dynamite");
  if (dynamite) {
    actor.equipment.splice(actor.equipment.indexOf(dynamite), 1);
    return beginJudgment(state, actor, "dynamite", { delayedCard: dynamite }, now, random);
  }
  const jail = equipment(actor, "jail");
  if (jail) {
    actor.equipment.splice(actor.equipment.indexOf(jail), 1); discard(state, jail);
    return beginJudgment(state, actor, "jail", {}, now, random);
  }
  beginDraw(state, actor, now, random);
}
function beginDraw(state, actor, now, random) {
  if (["jesse_jones", "pedro_ramirez", "kit_carlson"].includes(actor.characterId)) {
    state.pending = newPending(state, { type: "drawChoice", actorId: actor.id }); setPhase(state, "drawChoice", now, CHOICE_SECONDS);
  } else performDraw(state, actor, "deck", null, now, random);
}
function performDraw(state, actor, mode, targetId, now, random) {
  if (hasCharacter(actor, "kit_carlson")) {
    const cards = []; for (let i = 0; i < 3; i += 1) { const card = drawOne(state, random); if (card) cards.push(card); }
    state.pending = newPending(state, { type: "kitChoice", actorId: actor.id, cards }); setPhase(state, "kitChoice", now, CHOICE_SECONDS); return;
  }
  if (mode === "steal" && hasCharacter(actor, "jesse_jones")) {
    const target = byId(state, targetId); fail(!target?.alive || target.id === actor.id || !target.hand.length, "invalid_draw_target", "杰西必须选择一名有手牌的其他存活玩家。");
    actor.hand.push(target.hand.splice(Math.floor(random() * target.hand.length), 1)[0]); drawCards(state, actor, 1, random);
  } else if (mode === "discard" && hasCharacter(actor, "pedro_ramirez") && state.discard.length) {
    actor.hand.push(state.discard.pop()); drawCards(state, actor, 1, random);
  } else drawCards(state, actor, 2, random);
  if (hasCharacter(actor, "black_jack")) {
    const shown = actor.hand[actor.hand.length - 1]; log(state, `${actor.name} 公开摸到的第二张牌：${cardName(shown?.type)}。`, now);
    if (isRed(shown)) drawCards(state, actor, 1, random);
  }
  enterPlay(state, actor.id, now);
}
function enterPlay(state, actorId, now) {
  const actor = byId(state, actorId); if (!actor?.alive) return;
  state.pending = null; setPhase(state, "play", now, TURN_SECONDS);
}
function nextTurn(state, now, random) {
  const index = findNextAliveIndex(state); if (index < 0) return;
  state.currentIndex = index; const actor = current(state); actor.bangPlayed = 0;
  state.turn += 1; state.pending = null; setPhase(state, "turnStart", now, CHOICE_SECONDS);
  continueTurnStart(state, actor.id, now, random);
}

function equipCard(state, actor, card, target, now, random) {
  const meta = CARD_META[card.type], receiver = target || actor, slot = meta.equipment;
  fail(card.type === "jail" && receiver.role === ROLES.SHERIFF, "sheriff_cannot_be_jailed", "不能把监狱放在警长面前。");
  fail(card.type === "jail" && receiver.id === actor.id, "cannot_jail_self", "不能把监狱放在自己面前。");
  fail(["jail", "dynamite"].includes(card.type) && equipment(receiver, slot), "duplicate_equipment", "目标面前已有同名延时牌。");
  const replaced = equipment(receiver, slot); if (replaced) { receiver.equipment.splice(receiver.equipment.indexOf(replaced), 1); discard(state, replaced); }
  receiver.equipment.push(card); log(state, `${actor.name} 装备了${cardName(card.type)}${receiver.id === actor.id ? "" : `到${receiver.name}面前`}。`, now); ensureSuzy(state, actor, random);
}
function finishPlayedCard(state, card) { discard(state, card); }
function makeDefense(state, actor, target, card, now, resume, sourceType = "bang") {
  state.pending = newPending(state, { type: "defense", actorId: target.id, sourceId: actor.id, card, sourceType, needed: hasCharacter(actor, "slab_the_killer") && sourceType === "bang" ? 2 : 1, played: 0, barrelUses: 0, resume });
  setPhase(state, "defense", now, RESPONSE_SECONDS);
}
function continueMulti(state, resume, now, random) {
  const queue = resume.queue.filter((id) => byId(state, id)?.alive);
  if (!queue.length) { finishPlayedCard(state, resume.card); return enterPlay(state, resume.actorId, now); }
  const target = byId(state, queue.shift()), actor = byId(state, resume.actorId);
  makeDefense(state, actor, target, resume.card, now, { ...resume, queue }, resume.sourceType);
}
function continueDuel(state, resume, now) {
  const responder = byId(state, resume.responderId), other = byId(state, resume.otherId);
  if (!responder?.alive || !other?.alive) { finishPlayedCard(state, resume.card); return enterPlay(state, resume.actorId, now); }
  state.pending = newPending(state, { type: "duel", actorId: responder.id, otherId: other.id, originalActorId: resume.actorId, card: resume.card });
  setPhase(state, "duel", now, 12);
}

function playCard(state, actor, action, now, random) {
  fail(state.phase !== "play" || current(state)?.id !== actor.id, "not_your_play_phase", "现在不是你的出牌阶段。", 409);
  const card = removeCard(actor, action.cardId), type = card.type, meta = CARD_META[type];
  try {
    if (meta.color === "blue") {
      const target = type === "jail" ? byId(state, action.targetId) : actor;
      fail(type === "jail" && !target, "target_required", "请选择监狱目标。"); equipCard(state, actor, card, target, now, random); return;
    }
    if (type === "bang") {
      const target = byId(state, action.targetId);
      fail(!canBang(state, actor, target), "target_out_of_range", "目标不在武器射程内。");
      const unlimited = hasCharacter(actor, "willy_the_kid") || equipment(actor, "weapon")?.type === "volcanic";
      fail(actor.bangPlayed >= 1 && !unlimited, "bang_limit", "本回合已经使用过【砰！】。"); actor.bangPlayed += 1;
      ensureSuzy(state, actor, random);
      log(state, `${actor.name} 对${target.name}使用了【砰！】。`, now);
      return makeDefense(state, actor, target, card, now, { type: "play", actorId: actor.id });
    }
    if (type === "missed") {
      fail(!hasCharacter(actor, "calamity_janet"), "missed_requires_response", "【闪！】只能用于响应【砰！】。");
      const result = playVirtualCardAfterRemoval(state, actor, card, action, now); if (!result) throw new GameRuleError("target_out_of_range", "目标不在射程内。"); ensureSuzy(state, actor, random); log(state, `${actor.name} 将【闪！】当作【砰！】使用。`, now); return;
    }
    if (type === "beer") { if (alive(state).length > 2) heal(actor); finishPlayedCard(state, card); log(state, `${actor.name} 使用了啤酒。`, now); ensureSuzy(state, actor, random); return; }
    if (type === "stagecoach" || type === "wells_fargo") { drawCards(state, actor, type === "stagecoach" ? 2 : 3, random); finishPlayedCard(state, card); log(state, `${actor.name} 使用了${cardName(type)}。`, now); return; }
    if (type === "saloon") { for (const player of alive(state)) heal(player); finishPlayedCard(state, card); ensureSuzy(state, actor, random); log(state, `${actor.name} 请所有存活玩家进入酒馆。`, now); return; }
    if (type === "panic" || type === "cat_balou") {
      const target = byId(state, action.targetId); fail(!canTouch(state, actor, target, type === "panic"), "invalid_target", "不能选择该目标。");
      const pool = [...target.hand.map((item) => ({ zone: "hand", card: item })), ...target.equipment.map((item) => ({ zone: "equipment", card: item }))];
      let selected = pool.find((item) => item.card.id === action.targetCardId);
      if (!selected && action.targetZone === "hand") selected = randomItem(pool.filter((item) => item.zone === "hand"), random);
      fail(!selected, "target_card_required", "请选择目标的一张可见装备，或选择其手牌区。");
      const zone = selected.zone === "hand" ? target.hand : target.equipment; zone.splice(zone.indexOf(selected.card), 1);
      if (type === "panic") actor.hand.push(selected.card); else discard(state, selected.card);
      finishPlayedCard(state, card); log(state, `${actor.name} 对${target.name}使用了${cardName(type)}。`, now); ensureSuzy(state, target, random); ensureSuzy(state, actor, random); return;
    }
    if (type === "duel") {
      const target = byId(state, action.targetId); fail(!target?.alive || target.id === actor.id, "invalid_target", "请选择其他存活玩家。");
      ensureSuzy(state, actor, random); log(state, `${actor.name} 向${target.name}发起决斗。`, now); return continueDuel(state, { responderId: target.id, otherId: actor.id, actorId: actor.id, card }, now);
    }
    if (type === "gatling" || type === "indians") {
      const queue = alive(state).filter((player) => player.id !== actor.id).map((player) => player.id);
      ensureSuzy(state, actor, random); log(state, `${actor.name} 使用了${cardName(type)}。`, now); return continueMulti(state, { type: "multi", queue, actorId: actor.id, card, sourceType: type }, now, random);
    }
    if (type === "general_store") {
      const choices = []; for (let i = 0; i < alive(state).length; i += 1) { const choice = drawOne(state, random); if (choice) choices.push(choice); }
      const living = alive(state), start = living.findIndex((player) => player.id === actor.id);
      const chooserIds = Array.from({ length: living.length }, (_, offset) => living[(start + offset) % living.length].id);
      state.pending = newPending(state, { type: "generalStore", actorId: actor.id, chooserIds, choices, card }); ensureSuzy(state, actor, random); log(state, `${actor.name} 开启了杂货店。`, now);
      setPhase(state, "generalStore", now, CHOICE_SECONDS); return;
    }
    throw new GameRuleError("unsupported_card", "这张牌暂时无法使用。");
  } catch (error) { actor.hand.push(card); throw error; }
}
function playVirtualCardAfterRemoval(state, actor, card, action, now) {
  const target = byId(state, action.targetId); if (!canBang(state, actor, target)) return false;
  const unlimited = hasCharacter(actor, "willy_the_kid") || equipment(actor, "weapon")?.type === "volcanic";
  if (actor.bangPlayed >= 1 && !unlimited) throw new GameRuleError("bang_limit", "本回合已经使用过【砰！】。");
  actor.bangPlayed += 1; makeDefense(state, actor, target, card, now, { type: "play", actorId: actor.id }); return true;
}

function endTurn(state, actor, now, random) {
  fail(state.phase !== "play" || current(state)?.id !== actor.id, "not_your_turn", "现在不能结束回合。");
  if (actor.hand.length > actor.life) { state.pending = newPending(state, { type: "discardExcess", actorId: actor.id, count: actor.hand.length - actor.life }); setPhase(state, "discardExcess", now, DISCARD_SECONDS); }
  else nextTurn(state, now, random);
}
function resolveDefense(state, actor, action, now, random) {
  const pending = state.pending; fail(pending?.actorId !== actor.id, "not_responder", "现在不需要你响应。", 409);
  const source = byId(state, pending.sourceId);
  if (action.type === "respond") {
    let card = removeCard(actor, action.cardId); const needed = pending.sourceType === "indians" ? "bang" : "missed";
    const valid = card.type === needed || (hasCharacter(actor, "calamity_janet") && ((needed === "bang" && card.type === "missed") || (needed === "missed" && card.type === "bang")));
    if (!valid) { actor.hand.push(card); throw new GameRuleError("wrong_response_card", `需要打出【${needed === "bang" ? "砰！" : "闪！"}】。`); }
    discard(state, card); ensureSuzy(state, actor, random); pending.played += 1; log(state, `${actor.name} 打出${cardName(card.type)}完成响应。`, now);
    if (pending.played < pending.needed) { state.deadline = now + RESPONSE_SECONDS * 1000; return; }
    const resume = pending.resume; if (resume?.type === "play") finishPlayedCard(state, pending.card);
    return resumeFlow(state, resume, now, random);
  }
  if (action.type === "useBarrel") {
    fail(pending.sourceType !== "bang", "barrel_not_available", "本次攻击不能使用木桶。");
    fail(!equipment(actor, "barrel") && !hasCharacter(actor, "jourdonnais"), "barrel_not_available", "你没有可用的木桶能力。");
    const availableUses = Number(Boolean(equipment(actor, "barrel"))) + Number(hasCharacter(actor, "jourdonnais"));
    fail(pending.barrelUses >= availableUses, "barrel_already_used", "本次攻击可用的木桶判定已经用完。"); pending.barrelUses += 1;
    return beginJudgment(state, actor, "barrel", { defense: clone(pending) }, now, random);
  }
  fail(action.type !== "takeHit", "invalid_response", "请选择响应方式。");
  const resume = pending.resume; if (resume?.type === "play") finishPlayedCard(state, pending.card);
  applyDamage(state, actor, 1, source, now, random, resume);
}
function resolveDuel(state, actor, action, now, random) {
  const pending = state.pending; fail(pending?.actorId !== actor.id, "not_responder", "现在不需要你响应。", 409);
  if (action.type === "respond") {
    const card = removeCard(actor, action.cardId); const valid = card.type === "bang" || (hasCharacter(actor, "calamity_janet") && card.type === "missed");
    if (!valid) { actor.hand.push(card); throw new GameRuleError("wrong_response_card", "决斗必须打出【砰！】。"); }
    discard(state, card); ensureSuzy(state, actor, random);
    return continueDuel(state, { responderId: pending.otherId, otherId: actor.id, actorId: pending.originalActorId, card: pending.card }, now);
  }
  fail(action.type !== "takeHit", "invalid_response", "请选择打出【砰！】或承受伤害。");
  const original = byId(state, pending.originalActorId); finishPlayedCard(state, pending.card);
  applyDamage(state, actor, 1, byId(state, pending.otherId), now, random, { type: "play", actorId: original.id });
}
function resolveDying(state, actor, action, now, random) {
  const pending = state.pending; const target = byId(state, pending?.actorId);
  fail(!target, "not_dying_player", "当前没有待救援的玩家。", 409);
  if (action.type === "useBeer") {
    fail(alive(state).length <= 2, "beer_disabled", "只剩两名玩家时【啤酒】不能生效。");
    const card = removeCard(actor, action.cardId); if (card.type !== "beer") { actor.hand.push(card); throw new GameRuleError("beer_required", "请选择【啤酒】。"); }
    discard(state, card); heal(target); ensureSuzy(state, actor, random);
    if (target.life > 0) resumeFlow(state, pending.resume, now, random); else state.deadline = now + RESPONSE_SECONDS * 1000;
    return;
  }
  fail(actor.id !== target.id, "only_victim_can_yield", "只有濒死玩家本人可以放弃或使用角色能力。", 409);
  if (action.type === "useSid") return useSid(state, actor, action.cardIds, now, random);
  fail(action.type !== "giveUp", "invalid_dying_action", "请选择自救或放弃。");
  const resume = pending.resume; beginElimination(state, actor, byId(state, pending.sourceId), now, random, resume);
}
function useSid(state, actor, cardIds, now, random) {
  fail(!hasCharacter(actor, "sid_ketchum"), "ability_unavailable", "你不是西德·凯查姆。");
  const ids = [...new Set((cardIds || []).map(String))]; fail(ids.length !== 2, "two_cards_required", "请选择两张手牌。");
  const cards = ids.map((id) => removeCard(actor, id)); discard(state, cards[0]); discard(state, cards[1]); heal(actor); ensureSuzy(state, actor, random);
  if (state.phase === "dying" && actor.life > 0) resumeFlow(state, state.pending.resume, now, random);
}

function startGame(state, actorId, now, random) {
  requireHost(state, actorId); fail(state.phase !== "lobby", "already_started", "游戏已经开始。");
  fail(state.players.length !== state.capacity, "room_not_full", `需要${state.capacity}名玩家才能开始。`);
  fail(state.players.some((player) => !player.connected), "player_offline", "所有入座玩家在线后才能开始。", 409);
  const roles = shuffle(ROLE_DISTRIBUTION[state.capacity], random), chars = shuffle(CHARACTERS, random), deck = shuffle(createDeck(), random);
  state.deck = deck; state.discard = []; state.turn = 1; state.winner = null;
  for (let index = 0; index < state.players.length; index += 1) {
    const player = state.players[index]; player.role = roles[index]; player.characterId = chars[index].id; player.maxLife = chars[index].life + (player.role === ROLES.SHERIFF ? 1 : 0); player.life = player.maxLife; player.alive = true; player.hand = []; player.equipment = []; player.bangPlayed = 0;
    drawCards(state, player, player.maxLife, random);
  }
  const sheriffIndex = state.players.findIndex((player) => player.role === ROLES.SHERIFF); state.currentIndex = sheriffIndex;
  log(state, `游戏开始，${state.players[sheriffIndex].name}公开身份为警长。`, now); continueTurnStart(state, current(state).id, now, random);
}

export function createLobby({ capacity, host }) {
  return { stateVersion: STATE_VERSION, capacity: assertCapacity(capacity), phase: "lobby", deadline: 0, players: [makePlayer({ ...host, isHost: true })], deck: [], discard: [], currentIndex: 0, turn: 0, pending: null, effectSequence: 0, winner: null, logs: [], logSequence: 0 };
}
export function addPlayer(state, player) {
  fail(state.phase !== "lobby", "game_started", "牌局已经开始。", 409); fail(state.players.length >= state.capacity, "room_full", "玩家席已满。", 409); fail(byId(state, player.id), "duplicate_player", "该玩家已在房间中。", 409);
  const joined = makePlayer(player); state.players.push(joined); return joined;
}
export function removePlayer(state, actorId, playerId) {
  requireHost(state, actorId); fail(state.phase !== "lobby", "cannot_remove_active_player", "开局后不能移除玩家。", 409);
  const target = byId(state, playerId); fail(!target || target.isHost, "invalid_remove_target", "不能移除该玩家。"); state.players.splice(state.players.indexOf(target), 1);
}
export function canChangeSeats(state) { return state.phase === "lobby"; }
export function vacateSeat(state, playerId) {
  fail(state.phase !== "lobby", "seat_locked", "游戏开始后不能离开玩家席。", 409); const player = byId(state, playerId); fail(!player || player.isHost, "host_cannot_spectate", "房主不能进入旁观席。"); state.players.splice(state.players.indexOf(player), 1);
}
export function setPresence(state, playerId, connected) { const player = byId(state, playerId); if (player) player.connected = Boolean(connected); return player; }

export function applyAction(state, actorId, action, { now = Date.now(), random = Math.random } = {}) {
  const actor = requireActor(state, actorId); fail(!action?.type, "action_required", "缺少操作类型。");
  if (action.type === "setCapacity") { requireHost(state, actorId); fail(state.phase !== "lobby", "capacity_locked", "开局后不能修改人数。"); const capacity = assertCapacity(action.capacity); fail(capacity < state.players.length, "capacity_too_small", "人数不能少于已入座玩家。"); state.capacity = capacity; return; }
  if (action.type === "start") return startGame(state, actorId, now, random);
  if (action.type === "restart") { requireHost(state, actorId); fail(state.phase !== "ended", "not_ended", "牌局尚未结束。"); resetMatchToLobby(state); return; }
  if (action.type === "end") { requireHost(state, actorId); resetMatchToLobby(state); return; }
  fail(state.pending?.id && action.effectId !== state.pending.id, "stale_effect", "操作窗口已经变化，请根据最新画面重试。", 409);
  if (state.phase === "eliminationDiscard") {
    fail(action.type !== "orderEliminationDiscard", "discard_order_required", "请先确认出局弃牌顺序。");
    return resolveEliminationOrder(state, actor, action, now, random);
  }
  fail(!actor.alive, "eliminated_player", "你已经出局，不能执行游戏操作。", 403);
  if (action.type === "useSid" && state.phase !== "dying") return useSid(state, actor, action.cardIds, now, random);
  if (state.phase === "draw") { fail(current(state)?.id !== actor.id || action.type !== "draw", "draw_required", "请完成摸牌。"); return performDraw(state, actor, "deck", null, now, random); }
  if (state.phase === "drawChoice") { fail(state.pending?.actorId !== actor.id || action.type !== "chooseDraw", "draw_choice_required", "请完成摸牌选择。"); return performDraw(state, actor, action.mode, action.targetId, now, random); }
  if (state.phase === "kitChoice") {
    fail(state.pending?.actorId !== actor.id || action.type !== "chooseKit", "kit_choice_required", "请选择两张牌。"); const ids = [...new Set((action.cardIds || []).map(String))]; fail(ids.length !== 2, "choose_two", "请选择两张牌。"); const chosen = state.pending.cards.filter((card) => ids.includes(card.id)); fail(chosen.length !== 2, "invalid_kit_cards", "选择包含无效牌。"); const returned = state.pending.cards.find((card) => !ids.includes(card.id)); actor.hand.push(...chosen); if (returned) state.deck.push(returned); return enterPlay(state, actor.id, now);
  }
  if (state.phase === "judgmentChoice") {
    const pending = state.pending; fail(pending?.actorId !== actor.id || action.type !== "chooseJudgment", "judgment_choice_required", "请选择一张判定牌。");
    return finishJudgment(state, actor, pending.purpose, pending.cards, action.cardId, pending.context, now, random);
  }
  if (state.phase === "play") { if (action.type === "playCard") return playCard(state, actor, action, now, random); if (action.type === "endTurn") return endTurn(state, actor, now, random); }
  if (state.phase === "defense") return resolveDefense(state, actor, action, now, random);
  if (state.phase === "duel") return resolveDuel(state, actor, action, now, random);
  if (state.phase === "dying") return resolveDying(state, actor, action, now, random);
  if (state.phase === "discardExcess") {
    fail(state.pending?.actorId !== actor.id || action.type !== "discardCards", "discard_required", "请选择要弃掉的牌。"); const ids = [...new Set((action.cardIds || []).map(String))]; fail(ids.length !== state.pending.count, "wrong_discard_count", `需要弃掉${state.pending.count}张牌。`); for (const id of ids) discard(state, removeCard(actor, id)); ensureSuzy(state, actor, random); return nextTurn(state, now, random);
  }
  if (state.phase === "generalStore") {
    const pending = state.pending; fail(action.type !== "chooseStore" || pending.chooserIds[0] !== actor.id, "not_store_chooser", "还没有轮到你选择。"); const index = pending.choices.findIndex((card) => card.id === String(action.cardId)); fail(index < 0, "invalid_store_card", "该牌已被选走。"); actor.hand.push(pending.choices.splice(index, 1)[0]); pending.chooserIds.shift(); while (pending.chooserIds.length && !byId(state, pending.chooserIds[0])?.alive) pending.chooserIds.shift(); if (!pending.chooserIds.length) { for (const card of pending.choices) discard(state, card); finishPlayedCard(state, pending.card); enterPlay(state, pending.actorId, now); } else state.deadline = now + CHOICE_SECONDS * 1000; return;
  }
  throw new GameRuleError("action_not_allowed", "当前阶段不能执行这个操作。", 409);
}

function resetMatchToLobby(state) {
  state.phase = "lobby"; state.pending = null; state.winner = null; state.deadline = 0; state.deck = []; state.discard = []; state.currentIndex = 0; state.turn = 0;
  for (const player of state.players) Object.assign(player, { role: null, characterId: null, life: 0, maxLife: 0, hand: [], equipment: [], alive: true, bangPlayed: 0 });
}

export function handleTimeout(state, { now = Date.now(), random = Math.random } = {}) {
  if (!state.deadline || now < state.deadline) return false;
  const actor = byId(state, state.pending?.actorId) || current(state);
  if (["draw", "drawChoice"].includes(state.phase)) performDraw(state, actor, "deck", null, now, random);
  else if (state.phase === "kitChoice") { actor.hand.push(...state.pending.cards.slice(0, 2)); const returned = state.pending.cards[2]; if (returned) state.deck.push(returned); enterPlay(state, actor.id, now); }
  else if (state.phase === "judgmentChoice") applyAction(state, actor.id, { type: "chooseJudgment", cardId: state.pending.cards[0]?.id, effectId: state.pending.id }, { now, random });
  else if (state.phase === "play") endTurn(state, actor, now, random);
  else if (state.phase === "defense") resolveDefense(state, actor, { type: "takeHit" }, now, random);
  else if (state.phase === "duel") resolveDuel(state, actor, { type: "takeHit" }, now, random);
  else if (state.phase === "dying") resolveDying(state, actor, { type: "giveUp" }, now, random);
  else if (state.phase === "eliminationDiscard") resolveEliminationOrder(state, actor, { type: "orderEliminationDiscard", cardIds: state.pending.cardIds }, now, random);
  else if (state.phase === "discardExcess") { const ids = shuffle(actor.hand, random).slice(0, state.pending.count).map((card) => card.id); applyAction(state, actor.id, { type: "discardCards", cardIds: ids, effectId: state.pending.id }, { now, random }); }
  else if (state.phase === "generalStore") applyAction(state, state.pending.chooserIds[0], { type: "chooseStore", cardId: state.pending.choices[0]?.id, effectId: state.pending.id }, { now, random });
  else return false;
  return true;
}
export function getDeadline(state) { return Number(state.deadline) || 0; }

function publicCard(card, visible = true) { return visible ? { ...card, name: cardName(card.type) } : { id: null, type: null, hidden: true }; }
function publicPending(state, viewer) {
  const p = state.pending; if (!p) return null;
  if (p.type === "kitChoice") return { id: p.id, type: p.type, actorId: p.actorId, cards: viewer?.id === p.actorId ? p.cards.map((card) => publicCard(card)) : [] };
  if (p.type === "judgmentChoice") return { id: p.id, type: p.type, actorId: p.actorId, purpose: p.purpose, cards: viewer?.id === p.actorId ? p.cards.map((card) => publicCard(card)) : [] };
  if (p.type === "generalStore") return { id: p.id, type: p.type, actorId: p.actorId, chooserId: p.chooserIds[0] || null, choices: p.choices.map((card) => publicCard(card)) };
  return { id: p.id, type: p.type, actorId: p.actorId || null, sourceId: p.sourceId || p.otherId || null, sourceType: p.sourceType || null, needed: p.needed || null, played: p.played || 0, count: p.count || (p.cardIds?.length || 0) };
}
function permissions(state, viewer) {
  const id = viewer?.id;
  return {
    canManage: Boolean(viewer?.isHost), canKick: Boolean(viewer?.isHost), canSetCapacity: Boolean(viewer?.isHost && state.phase === "lobby"), canStart: Boolean(viewer?.isHost && state.phase === "lobby"), canEnd: Boolean(viewer?.isHost && state.phase !== "lobby"), canRestart: Boolean(viewer?.isHost && state.phase === "ended"),
    canDraw: state.phase === "draw" && current(state)?.id === id, canChooseDraw: state.phase === "drawChoice" && state.pending?.actorId === id, canChooseKit: state.phase === "kitChoice" && state.pending?.actorId === id,
    canChooseJudgment: state.phase === "judgmentChoice" && state.pending?.actorId === id,
    canPlay: state.phase === "play" && current(state)?.id === id, canRespond: ["defense", "duel"].includes(state.phase) && state.pending?.actorId === id,
    canSaveDying: state.phase === "dying" && Boolean(viewer?.alive), canResolveOwnDying: state.phase === "dying" && state.pending?.actorId === id,
    canOrderEliminationDiscard: state.phase === "eliminationDiscard" && state.pending?.actorId === id,
    canDiscard: state.phase === "discardExcess" && state.pending?.actorId === id, canChooseStore: state.phase === "generalStore" && state.pending?.chooserIds[0] === id
  };
}
function publicView(state, viewer = null) {
  const ended = state.phase === "ended";
  return {
    selfId: viewer?.id || null, phase: state.phase, capacity: state.capacity, deadline: state.deadline, turn: state.turn, currentPlayerId: current(state)?.id || null,
    deckCount: state.deck.length, discardTop: state.discard.length ? publicCard(state.discard[state.discard.length - 1]) : null, discardCount: state.discard.length,
    players: state.players.map((player) => ({ id: player.id, name: player.name, isHost: player.isHost, connected: player.connected, alive: player.alive, life: player.life, maxLife: player.maxLife, role: player.role === ROLES.SHERIFF || player.id === viewer?.id || ended || !player.alive ? player.role : null, characterId: player.characterId, characterName: character(player)?.name || null, characterText: character(player)?.text || null, handCount: player.hand.length, hand: player.id === viewer?.id || ended ? player.hand.map((card) => publicCard(card)) : player.hand.map(() => publicCard(null, false)), equipment: player.equipment.map((card) => publicCard(card)), distance: viewer?.alive && player.alive && player.id !== viewer.id ? livingDistance(state, viewer.id, player.id) : null })),
    pending: publicPending(state, viewer), winner: state.winner ? clone(state.winner) : null, logs: state.logs.map((entry) => ({ ...entry })), permissions: permissions(state, viewer)
  };
}
export function buildView(state, viewerId) { return publicView(state, requireActor(state, viewerId)); }
export function buildSpectatorView(state) { return publicView(state, null); }

export function validateState(state) {
  if (!state || !Array.isArray(state.players)) throw new Error("Invalid game19 state");
  if (state.players.length > state.capacity || state.capacity < MIN_PLAYERS || state.capacity > MAX_PLAYERS) throw new Error("Invalid player capacity");
  if (state.phase !== "lobby") {
    const cards = [...state.deck, ...state.discard, ...state.players.flatMap((player) => [...player.hand, ...player.equipment])];
    if (state.pending?.type === "kitChoice") cards.push(...state.pending.cards);
    if (state.pending?.type === "judgmentChoice") {
      cards.push(...state.pending.cards);
      if (state.pending.context?.delayedCard) cards.push(state.pending.context.delayedCard);
      if (state.pending.context?.defense?.card) cards.push(state.pending.context.defense.card);
    }
    if (state.pending?.type === "generalStore") cards.push(...state.pending.choices, state.pending.card);
    else if (["defense", "duel"].includes(state.pending?.type) && state.pending.card) cards.push(state.pending.card);
    else if (state.pending?.type === "dying" && state.pending.resume?.card) cards.push(state.pending.resume.card);
    const ids = cards.filter(Boolean).map((card) => card.id);
    if (ids.length !== 80 || new Set(ids).size !== 80) throw new Error(`BANG card conservation failed: ${ids.length}/${new Set(ids).size}`);
  }
  return true;
}
export function serializeState(state) { validateState(state); return clone(state); }
export function restoreState(serializedState) { if (serializedState?.stateVersion !== STATE_VERSION) throw new Error(`Unsupported game19 state version: ${serializedState?.stateVersion}`); const state = clone(serializedState); validateState(state); return state; }
