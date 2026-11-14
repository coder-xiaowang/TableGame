"use strict";

const PARTITIONS = Object.freeze([
  "room", "status", "players", "words", "decision", "logFilter", "log"
]);
const key = (value) => JSON.stringify(value);

function currentPlayer(view) {
  return view?.players?.find((player) => player.isCurrent) || null;
}

export function game1DecisionContext(view, memberRole = view?.roomRole, roomCode = "") {
  if (!view) return { mode:"none", key:"none" };
  const current = currentPlayer(view);
  const me = view.players.find((player) => player.id === view.selfId);
  const myWord = view.words?.find((item) => item.id === view.selfId);
  let mode = view.phase;
  let facts = null;
  if (memberRole === "spectator") {
    mode = `spectator:${view.phase}:${view.currentQuestion?.id || "none"}`;
    facts = view.currentQuestion ? [view.currentQuestion.askerName,view.currentQuestion.text] : null;
  } else if (view.phase === "collectingWords") {
    mode = `collecting:${view.playerWordMode}:${view.wordExtraMode}`;
    facts = Boolean(view.submittedPlayerIds?.includes(view.selfId));
  } else if (view.phase === "playing" && me?.status !== "playing") {
    mode = "playing:finished";
  } else if (view.phase === "playing" && view.currentQuestion) {
    const myAnswer = view.currentQuestion.answers?.[view.selfId] || "";
    mode = `question:${view.currentQuestion.id}:${view.currentQuestion.askerId === view.selfId ? "asker" : myAnswer ? "answered" : "answer"}`;
    facts = [view.currentQuestion.text,view.currentQuestion.answers,myAnswer,view.playerWordMode];
  } else if (view.phase === "playing" && current?.id === view.selfId) {
    mode = `turn:${view.turnQuestionAsked ? "after-question" : "before-question"}`;
    facts = [view.wordExtraMode,myWord?.extra || ""];
  } else if (view.phase === "playing") {
    mode = `waiting:${current?.id || "none"}`;
    facts = current?.name || "";
  } else if (view.phase === "ended") {
    facts = [view.winners,view.players.map((player) => [player.id,player.name,player.status])];
  }
  return { mode, key:key([roomCode,view.selfId,mode,facts]) };
}

export function createGame1RenderModel(view, {
  memberRole = view?.roomRole,
  roomCode = "",
  configuringRoom = false,
  logPlayerFilter = "all"
} = {}) {
  if (!view) return null;
  const players = Array.isArray(view.players) ? view.players : [];
  const permissions = view.permissions || {};
  const current = currentPlayer(view);
  const decisionContext = game1DecisionContext(view,memberRole,roomCode);
  return {
    view,memberRole,roomCode,configuringRoom,logPlayerFilter,current,decisionContext,
    keys:{
      room:key([
        roomCode,view.phase,players.length,configuringRoom,view.gameMode,view.topic,
        view.phase === "lobby" ? players.map((player) => [player.id,player.connected]) : null,
        permissions.canManage,permissions.canStart,permissions.canEnd
      ]),
      status:key([memberRole,view.phase,view.notice,view.round,current?.id,current?.name]),
      players:key([
        view.phase,view.selfId,permissions.canKick,view.submittedPlayerIds || [],
        players.map((player) => [player.id,player.name,player.isHost,player.connected,player.status,player.isCurrent])
      ]),
      words:key([
        memberRole,view.phase,view.selfId,view.wordExtraMode,view.playerWordMode,
        view.words || [],players.map((player) => [player.id,player.connected,player.status,player.isCurrent])
      ]),
      decision:decisionContext.key,
      logFilter:key([logPlayerFilter,players.map((player) => [player.id,player.name])]),
      log:key([logPlayerFilter,view.log || []])
    }
  };
}

export function createGame1PartitionRenderer(renderers = {}) {
  let previousKeys = null;
  function render(model,{force=false}={}) {
    if (!model) return [];
    const changed=[];
    for (const partition of PARTITIONS) {
      if (force || !previousKeys || previousKeys[partition] !== model.keys[partition]) {
        renderers[partition]?.(model);
        changed.push(partition);
      }
    }
    previousKeys={...model.keys};
    return changed;
  }
  return Object.freeze({render,reset(){previousKeys=null;},get keys(){return previousKeys&&{...previousKeys};}});
}

export const GAME1_RENDER_PARTITIONS = PARTITIONS;
