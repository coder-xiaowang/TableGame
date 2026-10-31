"use strict";

import { mountTablePresenceTool } from "./table-presence-toolbar.js";

export function normalizeLobbyReadiness(value={}){
  const members=Array.isArray(value.members)?value.members.map((member)=>Object.freeze({
    id:String(member?.id||""),
    isHost:Boolean(member?.isHost),
    connected:Boolean(member?.connected),
    ready:Boolean(member?.ready)
  })).filter((member)=>member.id):[];
  const readyCount=members.filter((member)=>member.ready).length;
  return Object.freeze({
    active:value.active===true,
    members:Object.freeze(members),
    readyCount,
    total:members.length,
    allReady:value.active===true&&members.length>0&&readyCount===members.length
  });
}

export function createLobbyReadinessLayer({
  room,
  documentRef=globalThis.document,
  notify=(message)=>globalThis.alert?.(message)
}={}){
  if(!documentRef?.body||!room?.setLobbyReady||!room?.subscribeLobbyReadiness){
    return Object.freeze({sync(){},receive(){},refresh(){},destroy(){},snapshot:()=>normalizeLobbyReadiness()});
  }
  const style=documentRef.createElement("style");style.dataset.lobbyReadinessStyle="";style.textContent=`
    .shared-lobby-ready-control{display:inline-flex!important;align-items:center;justify-content:center;min-height:30px!important;margin-left:6px;padding:5px 10px!important;border:1px solid var(--lobby-ready-border,var(--line,rgba(120,120,120,.35)))!important;border-radius:999px!important;color:var(--lobby-ready-text,var(--ink,inherit))!important;background:var(--lobby-ready-bg,var(--panel,rgba(255,255,255,.88)))!important;font:700 12px/1.1 var(--lobby-ready-font,inherit)!important;white-space:nowrap;cursor:pointer}.shared-lobby-ready-control[hidden]{display:none!important}.shared-lobby-ready-control[data-host="true"]{cursor:default}.shared-lobby-ready-control[data-ready="true"]{border-color:var(--lobby-ready-accent,var(--accent,#4d9b67))!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--lobby-ready-accent,var(--accent,#4d9b67)) 20%,transparent)}
    .shared-lobby-player-ready{outline:3px solid var(--lobby-ready-accent,#38a866)!important;outline-offset:3px}.shared-lobby-player-waiting{outline:3px dashed var(--lobby-waiting-accent,#e1b33f)!important;outline-offset:3px}.shared-lobby-all-ready{box-shadow:0 0 0 3px color-mix(in srgb,var(--lobby-ready-accent,#38a866) 25%,transparent)!important}.shared-lobby-readiness-blocked{filter:saturate(.65);cursor:not-allowed!important}
    @media(max-width:520px){.shared-lobby-ready-control{min-width:30px!important;padding:5px 8px!important}}
  `;documentRef.head?.append(style);
  const control=documentRef.createElement("button");control.type="button";control.className="shared-lobby-ready-control";control.hidden=true;control.setAttribute("aria-label","准备状态");
  mountTablePresenceTool(control,"readiness",{documentRef});
  let model=normalizeLobbyReadiness(),selfId="",role="",sending=false;const registrations=new Set();
  function findAnchor(memberId){if(!memberId)return null;const escaped=globalThis.CSS?.escape?globalThis.CSS.escape(memberId):memberId.replace(/["\\]/g,"\\$&");return documentRef.querySelector?.(`[data-player-anchor="${escaped}"]`)||documentRef.querySelector?.(`[data-player-id="${escaped}"]`)||documentRef.querySelector?.(`[data-id="${escaped}"]`)||null;}
  function clearIndicators(){for(const anchor of documentRef.querySelectorAll?.(".shared-lobby-player-ready,.shared-lobby-player-waiting")||[]){anchor.classList?.remove("shared-lobby-player-ready");anchor.classList?.remove("shared-lobby-player-waiting");}}
  function syncStartButton(){const start=documentRef.getElementById?.("startGameButton");if(!start)return;const blocked=model.active&&!model.allReady;start.classList?.toggle?.("shared-lobby-all-ready",model.active&&model.allReady);start.classList?.toggle?.("shared-lobby-readiness-blocked",blocked);start.setAttribute?.("aria-disabled",String(blocked));if(model.active){start.dataset.lobbyReadiness=`${model.readyCount}/${model.total}`;start.title=model.allReady?"所有正式玩家都已准备":`仍有玩家未准备（${model.readyCount}/${model.total}）`;}else{delete start.dataset.lobbyReadiness;start.classList?.remove?.("shared-lobby-readiness-blocked");start.setAttribute?.("aria-disabled","false");if(start.title?.startsWith("仍有玩家未准备")||start.title==="所有正式玩家都已准备")start.title="";}}
  function refresh(){
    clearIndicators();
    const self=model.members.find((member)=>member.id===selfId);
    control.hidden=!model.active||role==="spectator";
    control.dataset.host=String(Boolean(self?.isHost));control.dataset.ready=String(Boolean(self?.ready));
    if(self?.isHost){control.textContent=`准备 ${model.readyCount}/${model.total}`;control.disabled=true;}
    else{control.textContent=self?.ready?"✓ 已准备":"○ 点击准备";control.disabled=sending||!self?.connected;}
    if(model.active){for(const member of model.members){const anchor=findAnchor(member.id);if(!anchor)continue;anchor.classList?.add(member.ready?"shared-lobby-player-ready":"shared-lobby-player-waiting");}}
    syncStartButton();
  }
  function sync(view,snapshot={}){selfId=String(view?.selfId||snapshot.playerId||"");role=String(view?.roomRole||snapshot.memberRole||"");model=normalizeLobbyReadiness(view?.lobbyReadiness);const self=model.members.find((member)=>member.id===selfId),registrationKey=`${snapshot.roomCode||"room"}:${selfId}`;if(model.active&&role==="player"&&self&&!self.isHost&&self.connected&&!registrations.has(registrationKey)){registrations.add(registrationKey);sending=true;room.setLobbyReady(self.ready).catch(()=>registrations.delete(registrationKey)).finally(()=>{sending=false;refresh();});}queueMicrotask(refresh);}
  function receive(value){model=normalizeLobbyReadiness(value);refresh();}
  async function toggleReady(){const self=model.members.find((member)=>member.id===selfId);if(sending||!model.active||role==="spectator"||self?.isHost||!self?.connected)return;sending=true;refresh();try{await room.setLobbyReady(!self.ready);}catch(error){notify(`修改准备状态失败：${error?.message||"请稍后重试"}`);}finally{sending=false;refresh();}}
  function guardStart(event){if(!model.active||model.allReady)return;event.preventDefault?.();event.stopImmediatePropagation?.();notify(`仍有玩家未准备（${model.readyCount}/${model.total}），暂时不能开始游戏。`);}
  const unsubscribe=room.subscribeLobbyReadiness(receive);control.addEventListener("click",toggleReady);documentRef.getElementById?.("startGameButton")?.addEventListener?.("click",guardStart,true);
  return Object.freeze({sync,receive,refresh,snapshot:()=>model,destroy(){unsubscribe?.();clearIndicators();const start=documentRef.getElementById?.("startGameButton");start?.classList?.remove?.("shared-lobby-all-ready");start?.classList?.remove?.("shared-lobby-readiness-blocked");start?.removeEventListener?.("click",guardStart,true);control.remove();style.remove();}});
}
