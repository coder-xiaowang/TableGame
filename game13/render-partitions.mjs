"use strict";

const PARTITIONS=Object.freeze(["room","status","table","players","targetNotice","score","decision","result","log","countdown"]);
const key=(value)=>JSON.stringify(value);

export function createGame13RenderModel(view,{memberRole=view?.roomRole,roomCode="",selected=[]}={}){
  if(!view)return null;
  const players=Array.isArray(view.players)?view.players:[];
  const permissions=view.permissions||{};
  const current=players.find((player)=>player.id===view.currentPlayerId)||null;
  const selectedKeys=Array.isArray(selected)?selected:[];
  const swapSeats=permissions.canUsePower && view.pendingCard?.power==="swap" && selectedKeys.length
    ? players.map(player=>[player.name,player.slots.map(slot=>slot.slotId)])
    : null;
  return{view,memberRole,roomCode,current,isSpectator:memberRole==="spectator",selected:selectedKeys,keys:{
    room:key([roomCode,view.phase,view.capacity,players.length,
      permissions.canStart?players.map((player)=>[player.id,player.connected]):null,
      permissions.canManage,permissions.canStart,permissions.canEnd,permissions.canSetCapacity]),
    status:key([memberRole,view.phase,view.round,view.currentPlayerId,current?.name||"",view.winnerIds,players.map((player)=>[player.id,player.name]),view.capacity]),
    table:key([view.deckCount,view.discardCount,view.discardTop,view.pendingCard,view.cabo,permissions.canDraw]),
    players:key([memberRole,view.selfId,view.phase,view.currentPlayerId,permissions.canKick,selectedKeys,view.targetNotice,
      players.map((player)=>[player.id,player.name,player.isHost,player.connected,player.slots])]),
    targetNotice:key([view.targetNotice,players.map((player)=>[player.id,player.name,player.slots.map((slot)=>slot.slotId)])]),
    score:key(players.map((player)=>[player.id,player.name,player.score,player.resetUsed])),
    decision:key([memberRole,view.phase,view.currentPlayerId,current?.name||"",view.pendingCard,view.discardTop,permissions,selectedKeys,swapSeats]),
    result:key([view.roundResult,players.map((player)=>[player.id,player.name])]),
    log:key(view.logs||[]),
    countdown:key([view.deadline||0])
  }};
}

export function createGame13PartitionRenderer(renderers={}){
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

export const GAME13_RENDER_PARTITIONS=PARTITIONS;
