"use strict";

import { mountTablePresenceTool } from "./table-presence-toolbar.js";
import { mountPlayerPresenceBadge, unmountPlayerPresenceBadge } from "./player-presence-rail.js";

export const PUBLIC_MEMBER_STATUSES=Object.freeze([
  Object.freeze({id:"present",icon:"●",label:"在桌边"}),
  Object.freeze({id:"thinking",icon:"💭",label:"思考中"}),
  Object.freeze({id:"away",icon:"☕",label:"暂时离开"}),
  Object.freeze({id:"help",icon:"🙋",label:"需要说明"})
]);

const DEFINITIONS=new Map(PUBLIC_MEMBER_STATUSES.map((status)=>[status.id,status]));

export function normalizePublicMemberStatus(value){
  const id=String(value?.status||value||"");
  const definition=DEFINITIONS.get(id);if(!definition)return null;
  return Object.freeze({
    ...definition,
    memberId:String(value?.id||value?.memberId||""),
    updatedAt:Number(value?.updatedAt)||0
  });
}

export function createPublicMemberStatusLayer({
  room,
  documentRef=globalThis.document,
  windowRef=globalThis.window,
  notify=(message)=>globalThis.alert?.(message),
  enabled=false
}={}){
  if(enabled!==true||!documentRef?.body||!room?.setMemberStatus||!room?.subscribeMemberStatuses){
    return Object.freeze({sync(){},receive(){},refresh(){},open(){},close(){},destroy(){},currentStatus:()=>"present"});
  }
  const style=documentRef.createElement("style");style.dataset.publicMemberStatusStyle="";style.textContent=`
    .shared-member-status-button{position:relative;display:inline-grid;place-items:center;min-width:30px!important;width:30px;height:30px!important;margin-left:6px;padding:0!important;border:1px solid var(--member-status-border,var(--line,rgba(120,120,120,.35)))!important;border-radius:50%!important;color:var(--member-status-text,var(--ink,inherit))!important;background:var(--member-status-bg,var(--panel,rgba(255,255,255,.88)))!important;font:700 15px/1 sans-serif!important;cursor:pointer}
    .shared-member-status-panel{position:fixed;z-index:1220;display:grid;gap:6px;width:min(230px,calc(100vw - 20px));padding:10px;border:1px solid var(--member-status-menu-border,#c9c2b8);border-radius:var(--member-status-radius,12px);color:var(--member-status-menu-text,#182128)!important;background:var(--member-status-menu-bg,#fffaf2)!important;box-shadow:0 16px 38px rgba(0,0,0,.25);font:13px/1.3 var(--member-status-font,inherit);text-shadow:none!important;color-scheme:light}
    .shared-member-status-panel[hidden]{display:none!important}.shared-member-status-panel strong{color:inherit!important;padding:2px 4px 5px}.shared-member-status-choice{display:grid!important;grid-template-columns:24px 1fr auto;align-items:center;gap:7px;min-height:38px!important;padding:6px 9px!important;border:1px solid var(--member-status-menu-choice-border,transparent)!important;border-radius:9px!important;color:var(--member-status-menu-text,#182128)!important;background:var(--member-status-menu-choice-bg,#f0ece4)!important;font:inherit!important;text-align:left!important;text-shadow:none!important;cursor:pointer}.shared-member-status-choice:hover,.shared-member-status-choice:focus-visible,.shared-member-status-choice[aria-checked="true"]{border-color:var(--member-status-accent,var(--accent,#a45c19))!important;background:var(--member-status-menu-choice-hover,#e8e1d6)!important}.shared-member-status-choice[aria-checked="true"]::after{content:"✓";color:var(--member-status-accent,var(--accent,#a45c19));font-weight:900}.shared-member-status-choice .status-icon{font-size:17px;text-align:center}
    .shared-member-status-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid var(--member-status-badge-border,rgba(255,255,255,.46));border-radius:999px;color:var(--member-status-badge-text,#fff);background:var(--member-status-badge-bg,rgba(31,35,42,.9));box-shadow:0 4px 12px rgba(0,0,0,.22);font:700 11px/1.15 var(--member-status-font,inherit);white-space:nowrap;pointer-events:none;backdrop-filter:blur(5px)}.shared-member-status-badge[data-status="present"]{--member-status-badge-bg:rgba(42,112,72,.94)}.shared-member-status-badge[data-status="thinking"]{--member-status-badge-bg:rgba(74,63,128,.95)}.shared-member-status-badge[data-status="away"]{--member-status-badge-bg:rgba(124,76,34,.95)}.shared-member-status-badge[data-status="help"]{--member-status-badge-bg:rgba(145,54,54,.96)}
    @media(max-width:520px){.shared-member-status-badge{padding:3px 5px;font-size:10px}}
  `;documentRef.head?.append(style);
  const button=documentRef.createElement("button");button.type="button";button.className="shared-member-status-button";button.title="设置公开状态";button.setAttribute("aria-label","设置公开状态");button.setAttribute("aria-expanded","false");button.textContent="●";
  mountTablePresenceTool(button,"status",{documentRef});
  const panel=documentRef.createElement("section");panel.className="shared-member-status-panel";panel.hidden=true;panel.setAttribute("aria-label","公开玩家状态");const heading=documentRef.createElement("strong");heading.textContent="我的公开状态";panel.append(heading);
  const choices=new Map();
  for(const status of PUBLIC_MEMBER_STATUSES){const choice=documentRef.createElement("button");choice.type="button";choice.className="shared-member-status-choice";choice.dataset.status=status.id;choice.setAttribute("role","menuitemradio");const icon=documentRef.createElement("span"),label=documentRef.createElement("span");icon.className="status-icon";icon.textContent=status.icon;label.textContent=status.label;choice.append(icon,label);panel.append(choice);choices.set(status.id,choice);}
  documentRef.body.append(panel);
  const statuses=new Map();let latestView=null,selfId="",sending=false;
  function setButtonStatus(statusId){const definition=DEFINITIONS.get(statusId)||DEFINITIONS.get("present");button.textContent=definition.icon;button.title=`公开状态：${definition.label}`;for(const [id,choice] of choices)choice.setAttribute("aria-checked",String(id===definition.id));}
  function findAnchor(memberId){if(!memberId)return null;const escaped=globalThis.CSS?.escape?globalThis.CSS.escape(memberId):memberId.replace(/["\\]/g,"\\$&");return documentRef.querySelector?.(`[data-player-anchor="${escaped}"]`)||documentRef.querySelector?.(`[data-player-id="${escaped}"]`)||documentRef.querySelector?.(`[data-id="${escaped}"]`)||documentRef.querySelector?.(`[data-spectator-id="${escaped}"]`)||null;}
  function isConnected(memberId){const player=latestView?.players?.find?.((item)=>String(item.id)===String(memberId));if(player)return player.connected!==false;const spectator=latestView?.spectators?.find?.((item)=>String(item.id)===String(memberId));return spectator?.connected!==false;}
  function refresh(){
    for(const badge of documentRef.querySelectorAll?.(".shared-member-status-badge")||[])unmountPlayerPresenceBadge(badge);
    for(const [memberId,value] of statuses){
      if(!isConnected(memberId))continue;
      const definition=DEFINITIONS.get(value.status),anchor=findAnchor(memberId);if(!definition||!anchor)continue;
      const badge=documentRef.createElement("span");badge.className="shared-member-status-badge";badge.dataset.status=definition.id;badge.dataset.memberId=memberId;badge.title=definition.label;badge.setAttribute?.("aria-label",definition.label);const icon=documentRef.createElement("span"),label=documentRef.createElement("span");icon.textContent=definition.icon;label.className="status-label";label.textContent=definition.label;badge.append(icon,label);mountPlayerPresenceBadge(anchor,badge,"status",{documentRef});
    }
    setButtonStatus(statuses.get(selfId)?.status||"present");
  }
  function sync(view,snapshot={}){latestView=view;selfId=String(view?.selfId||snapshot.playerId||"");statuses.clear();for(const raw of view?.memberStatuses||[]){const normalized=normalizePublicMemberStatus(raw);if(normalized?.memberId)statuses.set(normalized.memberId,{status:normalized.id,updatedAt:normalized.updatedAt});}queueMicrotask(refresh);}
  function receive(raw){const normalized=normalizePublicMemberStatus(raw);if(!normalized?.memberId)return;const previous=statuses.get(normalized.memberId);if(previous&&previous.updatedAt>normalized.updatedAt)return;statuses.set(normalized.memberId,{status:normalized.id,updatedAt:normalized.updatedAt});refresh();}
  function positionPanel(){const rect=button.getBoundingClientRect(),margin=8;panel.hidden=false;panel.style.visibility="hidden";const width=panel.offsetWidth,height=panel.offsetHeight,viewportWidth=windowRef?.innerWidth||rect.right+width,viewportHeight=windowRef?.innerHeight||rect.bottom+height;panel.style.left=`${Math.max(margin,Math.min(viewportWidth-width-margin,rect.right-width))}px`;panel.style.top=`${rect.bottom+8+height<=viewportHeight-margin?rect.bottom+8:Math.max(margin,rect.top-height-8)}px`;panel.style.visibility="";}
  function open(){positionPanel();button.setAttribute("aria-expanded","true");}
  function close(){panel.hidden=true;button.setAttribute("aria-expanded","false");}
  async function choose(status){if(sending||!DEFINITIONS.has(status))return;sending=true;for(const choice of choices.values())choice.disabled=true;try{await room.setMemberStatus(status);close();}catch(error){notify(`修改公开状态失败：${error?.message||"请稍后重试"}`);}finally{sending=false;for(const choice of choices.values())choice.disabled=false;}}
  function onPanelClick(event){const status=event.target?.closest?.("[data-status]")?.dataset?.status||event.target?.dataset?.status;if(status)choose(status);}
  function onDocumentClick(event){if(panel.hidden||panel.contains(event.target)||event.target===button)return;close();}
  function onKeyDown(event){if(event.key==="Escape")close();}
  function onViewportChange(){close();refresh();}
  const unsubscribe=room.subscribeMemberStatuses(receive);button.addEventListener("click",()=>panel.hidden?open():close());panel.addEventListener("click",onPanelClick);documentRef.addEventListener("click",onDocumentClick);documentRef.addEventListener("keydown",onKeyDown);windowRef?.addEventListener?.("resize",onViewportChange);windowRef?.addEventListener?.("scroll",onViewportChange,true);
  return Object.freeze({sync,receive,refresh,open,close,currentStatus:()=>statuses.get(selfId)?.status||"present",destroy(){unsubscribe?.();close();for(const badge of documentRef.querySelectorAll?.(".shared-member-status-badge")||[])unmountPlayerPresenceBadge(badge);button.remove();panel.remove();style.remove();documentRef.removeEventListener("click",onDocumentClick);documentRef.removeEventListener("keydown",onKeyDown);windowRef?.removeEventListener?.("resize",onViewportChange);windowRef?.removeEventListener?.("scroll",onViewportChange,true);}});
}
