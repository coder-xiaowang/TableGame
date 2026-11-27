"use strict";

const PARTITIONS = Object.freeze([
  "room", "status", "players", "stage", "gallery", "hand",
  "decision", "decisionFacts", "log", "countdown"
]);

const key = (value) => JSON.stringify(value);

export function game23DecisionContext(view, memberRole = view?.roomRole, roomCode = "") {
  if (!view) return { mode: "none", key: "none" };
  const permissions = view.permissions || {};
  let mode = view.phase;
  if (memberRole === "spectator") mode = `spectator:${view.phase}`;
  else if (view.phase === "storytellerChoosing") mode = permissions.canTell ? "tell" : "wait-teller";
  else if (view.phase === "playersChoosing") mode = permissions.canSubmitDecoys ? "choose-decoys" : "decoys-sealed";
  else if (view.phase === "voting") mode = permissions.canVote ? "vote" : "vote-sealed";
  else if (view.phase === "resolution") mode = permissions.canContinue ? "resolution:discussion" : "resolution:wait";
  else if (view.phase === "discussion") mode = permissions.canContinue ? "discussion:continue" : "discussion:wait";
  return {
    mode,
    key: key([roomCode, view.selfId, view.matchNumber, view.round, view.storytellerId, mode])
  };
}

export function createGame23RenderModel(view, {
  memberRole = view?.roomRole,
  roomCode = "",
  draft = {}
} = {}) {
  if (!view) return null;
  const players = Array.isArray(view.players) ? view.players : [];
  const permissions = view.permissions || {};
  const decisionContext = game23DecisionContext(view, memberRole, roomCode);
  return {
    view, memberRole, roomCode, draft, decisionContext,
    keys: {
      room: key([
        roomCode, view.phase, view.capacity, players.length,
        view.phase === "lobby" ? players.map((item) => [item.id, item.connected]) : null,
        permissions.canManage, permissions.canConfigure, permissions.canStart,
        permissions.canNextMatch, permissions.canEnd
      ]),
      status: key([
        memberRole, view.phase, view.round, view.storytellerId,
        view.phase === "lobby" ? [players.length, view.capacity] : null,
        players.map((item) => [item.id, item.name])
      ]),
      players: key([
        view.phase, view.selfId, view.storytellerId,
        players.map((item) => [
          item.id, item.name, item.isHost, item.connected, item.score, item.handCount
        ])
      ]),
      stage: key([
        view.phase, view.clue, view.submissionCount, view.requiredSubmissions,
        view.voteCount, players.length, view.roundResult?.allOrNone,
        view.roundResult?.correctVoters || []
      ]),
      gallery: key([
        view.phase, permissions.canVote, view.displayCards || [], view.ownDisplayIds || [],
        view.roundResult, view.roundResult ? players.map(player => [player.id, player.name]) : null,
        draft.voteId || ""
      ]),
      hand: key([
        memberRole, permissions.canTell, permissions.canSubmitDecoys,
        view.hand || [], view.mySubmittedCardIds || [], view.handSize, view.decoyCount,
        draft.selected || []
      ]),
      decision: decisionContext.key,
      decisionFacts: key([
        decisionContext.mode, players.length, view.capacity,
        view.submissionCount, view.requiredSubmissions, view.voteCount,
        view.result, draft.selected || [], draft.voteId || "",
        draft.clueText || "", draft.clueMode || "text"
      ]),
      log: key((view.logs || []).map((entry) => [entry.id, entry.text, entry.at])),
      countdown: key([view.phase, view.deadline || 0])
    }
  };
}

export function createGame23PartitionRenderer(renderers = {}) {
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
  return Object.freeze({
    render,
    reset() { previousKeys = null; },
    get keys() { return previousKeys && { ...previousKeys }; }
  });
}

export const GAME23_RENDER_PARTITIONS = PARTITIONS;
