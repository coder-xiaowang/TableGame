"use strict";

const PARTITIONS = Object.freeze([
  "room", "status", "lobby", "privateIntel", "transmission",
  "decision", "decisionFacts", "scores", "history", "result", "countdown"
]);
const key = (value) => JSON.stringify(value);

export function notebookEntries(records, team, number) {
  const entries = [];
  for (const record of records) {
    if (record.team !== team) continue;
    const position = record.code.indexOf(number);
    if (position >= 0) entries.push({ round: record.round, clue: record.clues[position] });
  }
  return entries.reverse();
}

function canGuess(view) {
  const role = view?.permissions?.guessRole;
  return view?.phase === "guess"
    && ((role === "decode" && !view.guessStatus?.decode)
      || (role === "intercept" && !view.guessStatus?.intercept));
}

export function game11DecisionContext(view, memberRole = view?.roomRole, roomCode = "") {
  if (!view) return { mode:"none", key:"none" };
  let mode = view.phase;
  if (memberRole === "spectator") mode = `spectator:${view.phase}`;
  else if (view.phase === "clue") mode = view.permissions?.canSubmitClues ? "compose-clues" : "wait-clues";
  else if (view.phase === "guess") mode = canGuess(view) ? `guess:${view.permissions.guessRole}` : "wait-guesses";
  else if (view.phase === "tiebreak") mode = view.permissions?.canSubmitTiebreak ? "compose-tiebreak" : "wait-tiebreak";
  return {
    mode,
    key:key([roomCode,view.selfId,view.round,view.turnTeam,view.encryptorId,mode])
  };
}

export function createGame11RenderModel(view, {
  memberRole = view?.roomRole,
  roomCode = ""
} = {}) {
  if (!view) return null;
  const players = Array.isArray(view.players) ? view.players : [];
  const me = players.find((player) => player.id === view.selfId) || null;
  const encryptor = players.find((player) => player.id === view.encryptorId) || null;
  const permissions = view.permissions || {};
  const decisionContext = game11DecisionContext(view,memberRole,roomCode);
  return {
    view,memberRole,roomCode,me,encryptor,decisionContext,
    keys:{
      room:key([
        roomCode,view.phase,view.capacity,players.length,
        view.phase === "lobby" ? players.map((player) => [player.id,player.connected,player.team,player.seat]) : null,
        permissions.canManage,permissions.canStart,permissions.canEnd
      ]),
      status:key([
        memberRole,view.phase,view.round,view.turnTeam,view.encryptorId,
        encryptor?.name || "",view.phase === "lobby" ? [players.length,view.capacity] : null
      ]),
      lobby:view.phase === "lobby" ? key([
        memberRole,view.selfId,permissions.canSit,permissions.canMove,
        players.map((player) => [player.id,player.name,player.isHost,player.connected,player.team,player.seat])
      ]) : key([view.phase]),
      privateIntel:key([
        memberRole,view.selfId,me?.team || null,view.code,
        me?.team ? view.teams?.[me.team]?.keywords || [] : []
      ]),
      transmission:key([
        memberRole,view.phase,view.turnTeam,view.encryptorId,encryptor?.name || "",
        view.clues || [],view.guessStatus,view.records?.at(-1) || null,view.tiebreakStatus
      ]),
      decision:decisionContext.key,
      decisionFacts:key([
        decisionContext.mode,view.guessDraft,view.guessStatus,view.tiebreakStatus,
        view.permissions?.guessRole
      ]),
      scores:key([
        view.teams?.white?.interceptions,view.teams?.white?.miscommunications,
        view.teams?.black?.interceptions,view.teams?.black?.miscommunications
      ]),
      history:key(view.records || []),
      result:view.phase === "ended" ? key([view.outcome,view.teams,view.records?.length]) : key([view.phase]),
      countdown:key([view.phase,view.deadline || 0])
    }
  };
}

export function createGame11PartitionRenderer(renderers = {}) {
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

export const GAME11_RENDER_PARTITIONS = PARTITIONS;
