export function teamDraftContext(view, roomCode) {
  return view?.phase === "teamProposal" && view.permissions?.canPropose
    ? JSON.stringify([roomCode, view.selfId, view.matchNumber, view.questIndex, view.proposalNumber, view.leaderId]) : null;
}
export function validTeamDraft(ids, view) {
  if (!view?.permissions?.canPropose || !Array.isArray(ids)) return [];
  const allowed = new Set(view.players.map(player => player.id));
  return [...new Set(ids)].filter(id => allowed.has(id)).slice(0, view.requiredTeamSize);
}
