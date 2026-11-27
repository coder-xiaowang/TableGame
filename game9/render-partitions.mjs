"use strict";

const PARTITIONS = Object.freeze([
  "room",
  "table",
  "players",
  "decision",
  "decisionFacts",
  "privateArea",
  "log",
  "countdown",
  "result"
]);

function key(value) {
  return JSON.stringify(value);
}

export function createGame9RenderModel(view, { memberRole = view?.roomRole, roomCode = "" } = {}) {
  if (!view) return null;
  const players = Array.isArray(view.players) ? view.players : [];
  const me = players.find((player) => player.id === view.selfId) || null;
  const previewCard = memberRole === "player" && view.phase === "playing"
    && Number.isInteger(view.activeCard)
    && me?.cards.some(card => Math.abs(card - view.activeCard) === 1)
    ? view.activeCard : null;
  const current = players[view.currentIndex] || null;
  const myTurn = memberRole === "player" && view.phase === "playing" && current?.id === view.selfId;
  const permissions = view.permissions || {};
  const lobbyReady = view.phase === "lobby"
    ? players.map((player) => [player.id, Boolean(player.connected)])
    : null;

  return {
    view,
    memberRole,
    roomCode,
    me,
    previewCard,
    current,
    myTurn,
    keys: {
      room: key([
        roomCode, view.phase, view.capacity, players.length, lobbyReady,
        permissions.canManage, permissions.canStart, permissions.canEnd
      ]),
      table: key([view.phase, view.deckCount, view.activeCard, view.pot]),
      players: key([
        view.phase, view.currentIndex, permissions.canKick,
        players.map((player) => [
          player.id, player.name, player.isHost, player.connected,
          player.cards, player.cardScore,
          // 自己的精确筹码属于私人分区；玩家牌区只保留一个稳定占位。
          player.id === view.selfId ? "self-private" : player.chips
        ])
      ]),
      // 只有权威操作上下文改变才替换按钮结构。
      decision: key([memberRole, view.phase, view.selfId, current?.id || null]),
      // 同一操作上下文中的数值变化只给现有节点打补丁。
      decisionFacts: key([
        memberRole, view.phase, view.selfId, current?.id || null,
        view.activeCard, view.pot, me?.chips ?? null
      ]),
      privateArea: key([
        memberRole, view.selfId, me?.chips ?? null, me?.cardScore ?? null, me?.cards || [], previewCard
      ]),
      log: key((view.logs || []).map((entry) => [entry.id, entry.text, entry.at])),
      countdown: key([view.phase, view.deadline || 0]),
      result: view.phase === "ended"
        ? key([
          view.phase, permissions.canRestart, view.winners || [], view.removed || [],
          players.map((player) => [player.id, player.name, player.cardScore, player.chips, player.finalScore])
        ])
        : key([view.phase, permissions.canRestart])
    }
  };
}

export function createGame9PartitionRenderer(renderers = {}) {
  let previousKeys = null;

  function render(model, { force = false } = {}) {
    if (!model) return [];
    const changed = [];
    for (const partition of PARTITIONS) {
      if (force || !previousKeys || previousKeys[partition] !== model.keys[partition]) {
        renderers[partition]?.(model);
        changed.push(partition);
      }
    }
    previousKeys = { ...model.keys };
    return changed;
  }

  function reset() {
    previousKeys = null;
  }

  return Object.freeze({ render, reset, get keys() { return previousKeys && { ...previousKeys }; } });
}

export const GAME9_RENDER_PARTITIONS = PARTITIONS;
