"use strict";

const PARTITIONS = Object.freeze([
  "room", "status", "players", "board", "dice",
  "decision", "log", "countdown", "result"
]);
const key = (value) => JSON.stringify(value);

export function game10DecisionContext(view, memberRole = view?.roomRole) {
  if (!view) return { mode:"none", key:"none" };
  const current = view.players?.[view.currentIndex] || null;
  const myTurn = view.phase === "playing" && current?.id === view.selfId;
  let mode = `${view.phase}:waiting`;
  if (memberRole === "spectator") mode = `spectator:${view.phase}`;
  else if (myTurn) mode = `${view.phase}:${view.turnStage}`;
  return {
    mode,myTurn,current,
    key:key([view.selfId,memberRole,view.phase,view.currentIndex,current?.id || null,mode,
      mode === "playing:choose" ? view.options || [] : null])
  };
}

export function createGame10RenderModel(view,{memberRole=view?.roomRole,roomCode=""}={}) {
  if (!view) return null;
  const players=Array.isArray(view.players)?view.players:[];
  const permissions=view.permissions||{};
  const current=players[view.currentIndex]||null;
  const decisionContext=game10DecisionContext(view,memberRole);
  return {view,memberRole,roomCode,current,decisionContext,keys:{
    room:key([roomCode,view.phase,view.capacity,players.length,
      view.phase==="lobby"?players.map((player)=>[player.id,player.connected]):null,
      permissions.canManage,permissions.canStart,permissions.canEnd,permissions.canRestart]),
    status:key([memberRole,view.phase,view.currentIndex,current?.id||null,current?.name||"",view.turnStage,view.dice]),
    players:key([view.selfId,view.phase,view.currentIndex,permissions.canKick,
      players.map((player)=>[player.id,player.name,player.isHost,player.connected,player.color,player.claimed])]),
    board:key([view.phase,view.currentIndex,view.turnProgress,view.closed,
      players.map((player)=>[player.id,player.name,player.color,player.progress])]),
    dice:key([roomCode,view.phase,view.rollId,view.dice,view.lastBust]),
    decision:decisionContext.key,
    log:key(view.logs||[]),
    countdown:key([view.phase,view.deadline||0]),
    result:view.phase==="ended"?key([view.winnerId,permissions.canRestart,
      players.map((player)=>[player.id,player.name,player.color,player.claimed])]):key([view.phase])
  }};
}

export function createGame10PartitionRenderer(renderers={}) {
  let previousKeys=null;
  function render(model,{force=false}={}) {
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

export const GAME10_RENDER_PARTITIONS=PARTITIONS;
