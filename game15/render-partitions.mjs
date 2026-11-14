"use strict";

const PARTITIONS=Object.freeze(["room","status","scoreboard","hand","table","decision","changeNotice","result","log","countdown"]);
const key=(value)=>JSON.stringify(value);

function localDraftFacts(draft){
  if(!draft)return null;
  return [draft.turnId,draft.base,draft.table,draft.handIds,draft.undoLength];
}

export function createGame15RenderModel(view,{memberRole=view?.roomRole,roomCode="",draft=null,selectedTileId=null,handSort="color",editStatus=null}={}){
  if(!view)return null;
  const players=Array.isArray(view.players)?view.players:[];
  const permissions=view.permissions||{};
  const self=players.find((player)=>player.id===view.selfId)||null;
  const current=players.find((player)=>player.id===view.currentPlayerId)||null;
  const draftFacts=localDraftFacts(draft);
  const handIds=draft?.handIds||view.hand?.map((tile)=>tile.id)||[];
  const tableLayout=draft&&permissions.canAct?draft.table:null;
  const selectedInHand=handIds.includes(selectedTileId)?selectedTileId:null;
  const selectedOnTable=(tableLayout||view.table||[]).some((meld)=>{
    const ids=meld.tileIds||meld.tiles?.map((tile)=>tile.id)||[];
    return ids.includes(selectedTileId);
  })?selectedTileId:null;
  return {view,memberRole,roomCode,draft,selectedTileId,handSort,self,current,keys:{
    room:key([roomCode,view.phase,view.capacity,players.length,permissions.canManage,permissions.canSetCapacity,
      permissions.canStart,permissions.canNextGame,permissions.canRestartMatch,permissions.canEnd,
      players.map((player)=>[player.id,player.connected])]),
    status:key([memberRole,view.phase,view.gameNumber,view.totalGames,view.poolCount,view.currentPlayerId,
      current?.name||"",view.turnEdited,permissions.canAct,players.length,view.capacity]),
    scoreboard:key([view.phase,view.currentPlayerId,permissions.canKick,
      players.map((player)=>[player.id,player.name,player.isHost,player.connected,player.opened,player.score,player.wins,player.handCount])]),
    hand:key([memberRole,view.phase,view.selfId,self?.opened,view.hand,handIds,handSort,selectedInHand]),
    table:key([view.phase,permissions.canAct,self?.opened,view.table,tableLayout,view.hand,selectedOnTable,view.lastChange]),
    decision:key([memberRole,view.phase,view.gameNumber,view.capacity,players.length,view.currentPlayerId,current?.name||"",
      view.turnEdited,permissions.canAct,permissions.canDraw,permissions.canPassEmpty,self?.opened,handSort,
      permissions.canAct?draftFacts:null,selectedTileId,editStatus]),
    changeNotice:key([view.lastChange,players.map((player)=>[player.id,player.name])]),
    result:key([view.gameResult,view.gameNumber,players.map((player)=>[player.id,player.name])]),
    log:key(view.logs||[]),
    countdown:key([view.phase,view.deadline||0])
  }};
}

export function createGame15PartitionRenderer(renderers={}){
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

export const GAME15_RENDER_PARTITIONS=PARTITIONS;
