"use strict";

const PARTITIONS=Object.freeze(["room","status","quests","players","focus","secret","decision","ceremony","log","countdown"]);
const key=(value)=>JSON.stringify(value);

function playerNames(players){return players.map((player)=>[player.id,player.name]);}

export function createGame22RenderModel(view,{memberRole="player",roomCode="",teamDraft=[],proposalPending=false}={}){
  if(!view)return null;
  const players=Array.isArray(view.players)?view.players:[];
  const permissions=view.permissions||{};
  const draft=[...teamDraft].sort();
  const decisionPermissions={
    canAcknowledge:permissions.canAcknowledge,canPropose:permissions.canPropose,
    canRequestExtension:permissions.canRequestExtension,canVoteExtension:permissions.canVoteExtension,
    canTeamVote:permissions.canTeamVote,canQuest:permissions.canQuest,canFailQuest:permissions.canFailQuest,
    canUseLady:permissions.canUseLady,canAssassinate:permissions.canAssassinate
  };
  const decisionProgress=view.phase==="secretReveal"&&!permissions.canAcknowledge?players.map((player)=>[player.id,player.secretAcknowledged])
    :view.phase==="teamProposal"?[
      view.proposalExtension?.requested,view.proposalExtension?.used,view.proposalExtension?.granted,
      permissions.canVoteExtension?null:[view.proposalExtension?.voteProgress,view.proposalExtension?.yes,view.proposalExtension?.no,view.proposalExtension?.required]
    ]
      :view.phase==="teamVote"&&!permissions.canTeamVote?view.teamVoteProgress
        :view.phase==="questAction"&&!permissions.canQuest?view.questProgress:null;
  return {view,memberRole,roomCode,teamDraft:draft,keys:{
    room:key([roomCode,view.capacity,view.preset,view.paceMode,view.timers,view.ladyEnabled,
      permissions.canManage,permissions.canConfigure,permissions.canStart,permissions.canNextMatch,permissions.canEnd,
      view.phase==="lobby"?players.map((player)=>[player.id,player.connected]):null]),
    status:key([memberRole,view.phase]),
    quests:key([view.capacity,view.questIndex,view.questResults,view.proposalNumber]),
    players:key([view.selfId,view.phase,view.leaderId,view.proposedTeam,view.teamVoteProgress,view.questProgress,
      view.lastTeamVoteResult?.votes||null,view.knownEvilIds,view.percivalCandidates,permissions.canPropose,
      permissions.canUseLady,permissions.ladyTargetIds,permissions.canAssassinate,draft,
      players.map((player)=>[player.id,player.name,player.isHost,player.connected,player.role,player.secretAcknowledged])]),
    focus:key([view.phase,view.capacity,view.preset,view.paceMode,view.ladyEnabled,view.leaderId,view.questIndex,
      view.proposalNumber,view.requiredTeamSize,view.requiredFails,view.proposedTeam,view.teamVoteProgress,
      view.questProgress,view.ladyHolderId,view.assassinId,view.proposalExtension,view.result,
      players.map((player)=>[player.id,player.name,player.secretAcknowledged])]),
    secret:key([memberRole,view.phase,view.selfRole,view.knownEvilIds,view.percivalCandidates,view.myLadyFinding,playerNames(players)]),
    decision:key([memberRole,view.phase,view.capacity,players.length,view.leaderId,view.questIndex,view.proposalNumber,
      view.requiredTeamSize,view.requiredFails,view.proposedTeam,view.ladyHolderId,view.result,
      decisionPermissions,decisionProgress,draft,playerNames(players),proposalPending]),
    ceremony:key(view.ceremony||null),
    log:key(view.logs||[]),
    countdown:key([view.phase,view.deadline||0,view.deadlineDurationSeconds||0])
  }};
}

export function createGame22PartitionRenderer(renderers={}){
  let previousKeys=null;
  function render(model,{force=false}={}){
    if(!model)return[];
    const changed=[];
    for(const partition of PARTITIONS){
      if(force||!previousKeys||previousKeys[partition]!==model.keys[partition]){
        renderers[partition]?.(model);changed.push(partition);
      }
    }
    previousKeys={...model.keys};
    return changed;
  }
  return Object.freeze({render,reset(){previousKeys=null;},get keys(){return previousKeys&&{...previousKeys};}});
}

export const GAME22_RENDER_PARTITIONS=PARTITIONS;
