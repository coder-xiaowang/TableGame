"use strict";

const PARTITIONS=Object.freeze(["room","status","table","players","private","decision","log","countdown"]);
const key=(value)=>JSON.stringify(value);

function decisionPending(view,permissions){
  const pending=view.pending;
  if(!pending)return null;
  return [pending.id,pending.type,pending.actorId,pending.sourceId,pending.sourceType,pending.needed,pending.played,pending.count,
    permissions.canChooseKit?pending.cards:null,
    permissions.canChooseJudgment?[pending.purpose,pending.cards]:null,
    permissions.canChooseStore?[pending.chooserId,pending.choices]:null];
}

export function createGame19RenderModel(view,{memberRole=view?.roomRole,roomCode="",selectedCardId=null,selectedTargetId=null}={}){
  if(!view)return null;
  const players=Array.isArray(view.players)?view.players:[];
  const permissions=view.permissions||{};
  const self=players.find((player)=>player.id===view.selfId)||null;
  const selectedCard=self?.hand?.find((card)=>card.id===selectedCardId)||null;
  const selectedTarget=players.find((player)=>player.id===selectedTargetId)||null;
  const decisionPermissions={
    canDraw:permissions.canDraw,canChooseDraw:permissions.canChooseDraw,canChooseKit:permissions.canChooseKit,
    canChooseJudgment:permissions.canChooseJudgment,canPlay:permissions.canPlay,canRespond:permissions.canRespond,
    canSaveDying:permissions.canSaveDying,canResolveOwnDying:permissions.canResolveOwnDying,
    canOrderEliminationDiscard:permissions.canOrderEliminationDiscard,canDiscard:permissions.canDiscard,
    canChooseStore:permissions.canChooseStore
  };
  const needsPlayerOptions=permissions.canPlay||permissions.canChooseDraw;
  return{view,memberRole,roomCode,self,selectedCardId:selectedCard?.id||null,selectedTargetId:selectedTarget?.id||null,keys:{
    room:key([roomCode,view.phase,view.capacity,players.length,
      permissions.canStart||permissions.canRestart?players.map((player)=>[player.id,player.connected]):null,
      permissions.canManage,permissions.canStart,permissions.canRestart,permissions.canEnd,permissions.canSetCapacity]),
    status:key([memberRole,view.phase,view.turn,view.currentPlayerId,players.length,view.capacity,
      players.map((player)=>[player.id,player.name])]),
    table:key([view.deckCount,view.discardTop,view.winner,view.phase,view.currentPlayerId,view.logs?.[0]?.text||"",
      view.recentJudgments,view.pending?.type === "judgmentChoice" ? [view.pending.actorId,view.pending.purpose] : null]),
    players:key([view.selfId,view.phase,view.currentPlayerId,view.pending?.actorId||null,view.pending?.sourceId||null,
      permissions.canManage,players.map((player)=>[player.id,player.name,player.isHost,player.connected,player.alive,player.life,
        player.maxLife,player.role,player.characterId,player.characterName,player.handCount,player.equipment,player.distance])]),
    private:key([memberRole,view.selfId,self?.characterId,self?.characterName,self?.role,self?.life,self?.maxLife,self?.hand||[],
      permissions.canPlay,selectedCard?.id||null]),
    decision:key([memberRole,view.phase,view.currentPlayerId,view.winner,decisionPending(view,permissions),decisionPermissions,
      selectedCard?.id||null,selectedTarget?.id||null,self?.characterId,self?.hand||[],self?.equipment||[],
      needsPlayerOptions?players.map((player)=>[player.id,player.name,player.alive,player.role,player.handCount,player.distance,player.equipment]):null]),
    log:key(view.logs||[]),
    countdown:key([view.phase,view.deadline||0])
  }};
}

export function createGame19PartitionRenderer(renderers={}){
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

export const GAME19_RENDER_PARTITIONS=PARTITIONS;
