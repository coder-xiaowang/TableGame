"use strict";

const PARTITIONS=Object.freeze(["room","status","deck","players","private","decision","log","countdown"]);
const key=(value)=>JSON.stringify(value);

export function courtDeclarations({ action, phase, challenge }) {
  if (!action) return [];
  const slips = [{ kind: "action", actorId: action.actorId, role: action.claimedRole }];
  if (action.blockerId) slips.push({ kind: "block", actorId: action.blockerId, role: action.blockRole });
  for (const slip of slips) {
    if ((phase === "challengeAction" && slip.kind === "action") || (phase === "challengeBlock" && slip.kind === "block")) {
      slip.stamp = "可质疑";
    } else if (phase === "proveClaim" && challenge?.context === slip.kind && challenge.claimantId === slip.actorId) {
      slip.stamp = "待举证";
    }
  }
  return slips;
}

export function createGame16RenderModel(view,{memberRole=view?.roomRole,roomCode="",selectedAction=null,exchangeSelection=[]}={}){
  if(!view)return null;
  const players=Array.isArray(view.players)?view.players:[];
  const permissions=view.permissions||{};
  const decisionPermissions={
    canDeclareAction:permissions.canDeclareAction,canRespond:permissions.canRespond,
    canChallenge:permissions.canChallenge,canBlock:permissions.canBlock,canProve:permissions.canProve,
    canLoseInfluence:permissions.canLoseInfluence,canExchange:permissions.canExchange
  };
  const self=players.find((player)=>player.id===view.selfId)||null;
  const winner=players.find((player)=>player.id===view.winnerId)||null;
  const selection=[...exchangeSelection].sort();
  return{view,memberRole,roomCode,self,winner,selectedAction,exchangeSelection:selection,keys:{
    room:key([roomCode,view.phase,view.capacity,players.length,
      permissions.canStart||permissions.canRestart?players.map((player)=>[player.id,player.connected]):null,
      permissions.canManage,permissions.canStart,permissions.canRestart,permissions.canEnd,permissions.canSetCapacity]),
    status:key([memberRole,view.phase,view.currentPlayerId,view.winnerId,winner?.name||"",players.length,view.capacity,
      players.map((player)=>[player.id,player.name])]),
    deck:key(view.deckCount),
    players:key([view.selfId,view.phase,view.currentPlayerId,permissions.canKick,
      players.map((player)=>[player.id,player.name,player.isHost,player.connected,player.coins,player.eliminated,player.influences])]),
    private:key([memberRole,view.selfId,self?.coins||0,self?.influences||[]]),
    decision:key([memberRole,view.phase,view.currentPlayerId,view.action,
      view.reaction?[view.reaction.id,view.reaction.kind,permissions.canRespond]:null,
      view.challenge,view.loss,view.exchange,view.proofOptions,decisionPermissions,selectedAction,selection,
      players.map((player)=>[player.id,player.name,player.coins,player.eliminated])]),
    log:key(view.logs||[]),
    countdown:key([view.phase,view.deadline||0])
  }};
}

export function createGame16PartitionRenderer(renderers={}){
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

export const GAME16_RENDER_PARTITIONS=PARTITIONS;
