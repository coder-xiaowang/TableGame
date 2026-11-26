"use strict";
import { createAuthoritativeRoomClient, createCountdown, createPresentationTimeline, createRoomEntryController, createSessionStore, createSpectatorUi, escapeHtml, renderConnectionStatus, renderCountdown, setHidden } from "/shared/client/index.js";
import { createGame22PartitionRenderer, createGame22RenderModel } from "./render-partitions.mjs";
import { createAvalonPlayerBadges } from "./player-badges.mjs";
import { canOpenPlayerAdminMenu } from "./player-admin-menu.mjs";
import { createScopedDraftStore } from "/shared/client/scoped-draft-store.js";
import { teamDraftContext, validTeamDraft } from "./team-draft.mjs";

const PROTOCOL_VERSION=3;
const ROLE_LABEL={merlin:"梅林",percival:"派西维尔",loyal:"亚瑟忠臣",assassin:"刺客",morgana:"莫甘娜",mordred:"莫德雷德",oberon:"奥伯伦",minion:"莫德雷德爪牙"};
const PRESET_LABEL={basic:"基础",classic:"经典",advanced:"进阶"};
const PACE_LABEL={quick:"快速",standard:"标准",discussion:"充分讨论",custom:"自定义"};
const DEFAULT_CUSTOM_TIMERS={secretReveal:45,teamProposal:180,teamVote:45,questAction:45,ladyInspect:60,assassination:150};
const PHASE_LABEL={lobby:"等待骑士入席",secretReveal:"确认秘密身份",teamProposal:"队长组建远征队",teamVote:"圆桌审议提案",questAction:"队员秘密执行任务",questReveal:"远征命运揭晓",ladyInspect:"湖中仙女查验",assassination:"刺客寻找梅林",assassinationReveal:"命运之刃落下",ended:"王国命运揭晓"};
const PLAYER_ACCENTS=["#d8b75f","#75aeca","#c87878","#8fbe87","#b38acb","#d99b62","#73b6aa","#c7c06d","#7f91c9","#c7829d"];
const BADGE_ICONS={
  leader:'<svg viewBox="0 0 24 24"><path d="M3 17h18l-2 4H5l-2-4Zm1-9 5 4 3-8 3 8 5-4-1 7H5L4 8Z"/></svg>',
  "known-evil":'<svg viewBox="0 0 24 24"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Zm10 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/></svg>',
  "merlin-candidate":'<svg viewBox="0 0 24 24"><path d="M4 5c3-2 5-2 8 0 3-2 5-2 8 0v7c0 5-4 8-8 9-4-1-8-4-8-9V5Zm3 5 3 2-3 2m10-4-3 2 3 2"/></svg>',
  expedition:'<svg viewBox="0 0 24 24"><path d="M12 2 20 5v6c0 5-3 9-8 11-5-2-8-6-8-11V5l8-3Zm0 4v11m-4-5 4 5 4-5"/></svg>',
  "vote-sealed":'<svg viewBox="0 0 24 24"><path d="M12 2 9 5 5 4l-1 4-3 3 3 3 1 4 4-1 3 3 3-3 4 1 1-4 3-3-3-3-1-4-4 1-3-3Zm0 6 3 3-3 5-3-5 3-3Z"/></svg>',
  "quest-sealed":'<svg viewBox="0 0 24 24"><path d="M7 3h10v3l-2 3v3c0 2 2 3 4 4v2H5v-2c2-1 4-2 4-4V9L7 6V3Zm-1 17h12v2H6v-2Z"/></svg>',
  "vote-yes":'<svg viewBox="0 0 24 24"><path d="m4 12 5 5L20 6l2 2L9 21 2 14l2-2Z"/></svg>',
  "vote-no":'<svg viewBox="0 0 24 24"><path d="m5 3 7 7 7-7 2 2-7 7 7 7-2 2-7-7-7 7-2-2 7-7-7-7 2-2Z"/></svg>',
  role:'<svg viewBox="0 0 24 24"><path d="M12 2 19 6v6c0 5-3 8-7 10-4-2-7-5-7-10V6l7-4Zm0 4-2 4-4 .5 3 3-.8 4.5 3.8-2 3.8 2-.8-4.5 3-3-4-.5-2-4Z"/></svg>'
};
const $=(id)=>document.getElementById(id);
const ids=["hero","connectionStatus","roomHeaderTools","hostTools","roomCodeDisplay","roomPlayerCountSelect","roomPresetSelect","paceModeSelect","customPaceButton","customPaceDialog","closePaceDialogButton","saveCustomPaceButton","paceSecretInput","paceProposalInput","paceVoteInput","paceQuestInput","paceLadyInput","paceAssassinationInput","ladySettingButton","spectatorSettingButton","seatActionButton","startGameButton","nextMatchButton","endGameButton","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","joinIntentField","phaseTitle","questTrack","rejectTrack","roundTable","questMapWorld","mapControls","mapZoomOutButton","mapResetButton","mapZoomInButton","mapZoomText","players","playerAdminMenu","playerAdminMenuTitle","removePlayerButton","focusLabel","focusText","focusHint","presentationEffects","presentationTrail","presentationAnnouncement","presentationLabel","presentationText","criticalCeremony","ceremonyKicker","ceremonyTitle","ceremonyHint","ceremonyCast","ceremonyCards","ceremonyVerdict","questArchive","questArchiveClose","questArchiveKicker","questArchiveTitle","questArchiveSummary","questArchivePlayers","controlDock","actionTitle","actionHint","actionButtons","timerText","timerBar","secretPanel","secretRole","secretKnowledge","toggleLogButton","logList","spectatorPanel","spectatorCountBadge","spectatorList"];
const E=Object.fromEntries(ids.map((id)=>[id,$(id)]));
let view=null,spectatorUi=null,presentation=null;
let teamDraft=new Set(),draftContext="",lastCountdownSeconds=0;
let proposalPending=false;
const teamDraftStore=createScopedDraftStore("avalon");
const mapView={scale:1,fitScale:1,x:0,y:0,ready:false,pointers:new Map(),gesture:null};
const sessions=createSessionStore({gameId:"avalon"});
const countdown=createCountdown({onTick(value){lastCountdownSeconds=value.seconds;renderCountdown({textElement:E.timerText,barElement:E.timerBar},value);const requestButton=E.actionButtons?.querySelector("[data-extension-request]");if(requestButton)requestButton.disabled=value.seconds>30||value.seconds<=0;}});
const room=createAuthoritativeRoomClient({protocolVersion:PROTOCOL_VERSION,sessionStore:sessions,onStatus(status){renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode);},handlers:{onView(next){reconcileDraft(next);view=next;enterRoom();render();presentation?.sync(next.presentationEvents.filter((event)=>!event.ceremony));},onKicked(){spectatorUi?.handleSessionEnded("kicked");},onRoomExpired(){spectatorUi?.handleSessionEnded("room_expired");}}});

spectatorUi=createSpectatorUi({room,getView:()=>view,elements:{joinIntentField:E.joinIntentField,seatActionButton:E.seatActionButton,spectatorSettingButton:E.spectatorSettingButton,spectatorPanel:E.spectatorPanel,spectatorCountBadge:E.spectatorCountBadge,spectatorList:E.spectatorList},notify:(message)=>alert(message),confirmAction:(message)=>confirm(message),onSessionEnded:()=>location.reload()});
const roomEntry=createRoomEntryController({room,spectatorUi,elements:{root:E.setupPanel,hostModeButton:E.hostModeButton,guestModeButton:E.guestModeButton,hostSetup:E.hostSetup,guestSetup:E.guestSetup,hostTools:E.hostTools,hostNameInput:E.hostNameInput,guestNameInput:E.guestNameInput,roomCodeInput:E.roomCodeInput,createRoomButton:E.createRoomButton,joinRoomButton:E.joinRoomButton,connectionStatus:E.connectionStatus},buildCreatePayload:()=>({capacity:Number(E.playerCountSelect.value)}),formatError:(kind,error)=>kind==="create"?`创建失败：${error.message}\n请确认已启动 game22 服务。`:`加入失败：${error.message}`});
function submit(action){return Promise.resolve(room.submitAction(action)).catch((error)=>{E.connectionStatus.textContent=`操作失败：${error.message}`;alert(error.message);return null;});}
function player(id){return view?.players.find((item)=>item.id===id)||null;} function nameOf(id){return player(id)?.name||"玩家";}
function playerIndex(id){return Math.max(0,view?.players.findIndex((item)=>item.id===id)??0);}
function playerAccent(id){return PLAYER_ACCENTS[playerIndex(id)%PLAYER_ACCENTS.length];}
function playerInitial(id){return [...nameOf(id)][0]||"骑";}
function badgeIcon(type){return BADGE_ICONS[type]||BADGE_ICONS.role;}
function badgeHtml(badge){const family=badge.type.startsWith("role-")?" role-badge":"";return `<i class="player-badge badge-${escapeHtml(badge.type)}${family}" role="img" aria-label="${escapeHtml(badge.label)}" title="${escapeHtml(badge.label)}">${badgeIcon(badge.type)}</i>`;}
function enterRoom(){setHidden(E.setupPanel,true);setHidden(E.roomPanel,false);setHidden(E.roomHeaderTools,false);E.roomCodeDisplay.textContent=room.snapshot().roomCode;E.hero.classList.add("in-room");if(!mapView.ready)requestAnimationFrame(resetMapView);}
function contextOf(next){return teamDraftContext(next,room.snapshot().roomCode);}
function reconcileDraft(next){
  const key=contextOf(next);
  if(draftContext!==key){teamDraft=new Set(validTeamDraft(teamDraftStore.load(key),next));proposalPending=false;}
  draftContext=key;
  teamDraft=new Set(validTeamDraft([...teamDraft],next));
  if(!key)teamDraftStore.clear();
}
async function proposeTeam(){
  if(proposalPending||!view?.permissions.canPropose||teamDraft.size!==view.requiredTeamSize)return;
  const context=draftContext,memberIds=[...teamDraft];proposalPending=true;render();
  try{await submit({type:"proposeTeam",memberIds});}
  finally{if(context===draftContext){proposalPending=false;render();}}
}
function addButton(label,onClick,className=""){const button=document.createElement("button");button.type="button";button.textContent=label;button.className=className;button.onclick=onClick;E.actionButtons.append(button);return button;}
function customTimersFromInputs(){return {secretReveal:Number(E.paceSecretInput.value),teamProposal:Number(E.paceProposalInput.value),teamVote:Number(E.paceVoteInput.value),questAction:Number(E.paceQuestInput.value),ladyInspect:Number(E.paceLadyInput.value),assassination:Number(E.paceAssassinationInput.value)};}
function openCustomPaceDialog(){const timers=view?.timers||DEFAULT_CUSTOM_TIMERS;E.paceSecretInput.value=timers.secretReveal;E.paceProposalInput.value=timers.teamProposal;E.paceVoteInput.value=timers.teamVote;E.paceQuestInput.value=timers.questAction;E.paceLadyInput.value=timers.ladyInspect;E.paceAssassinationInput.value=timers.assassination;E.customPaceDialog.showModal();}

function mapMetrics(){return {viewportWidth:E.roundTable.clientWidth,viewportHeight:E.roundTable.clientHeight,worldWidth:E.questMapWorld.offsetWidth,worldHeight:E.questMapWorld.offsetHeight};}
function mapFitScale(){const m=mapMetrics();return m.viewportWidth&&m.viewportHeight?Math.min(m.viewportWidth/m.worldWidth,m.viewportHeight/m.worldHeight):1;}
function clampMapView(){const m=mapMetrics(),scaledWidth=m.worldWidth*mapView.scale,scaledHeight=m.worldHeight*mapView.scale;mapView.x=scaledWidth<=m.viewportWidth?(m.viewportWidth-scaledWidth)/2:Math.min(0,Math.max(m.viewportWidth-scaledWidth,mapView.x));mapView.y=scaledHeight<=m.viewportHeight?(m.viewportHeight-scaledHeight)/2:Math.min(0,Math.max(m.viewportHeight-scaledHeight,mapView.y));}
function applyMapView(){clampMapView();mapView.lastWidth=E.roundTable.clientWidth;mapView.lastHeight=E.roundTable.clientHeight;E.questMapWorld.style.transform=`translate3d(${mapView.x}px,${mapView.y}px,0) scale(${mapView.scale})`;const relative=mapView.fitScale?mapView.scale/mapView.fitScale:1;E.mapZoomText.textContent=`${Math.round(relative*100)}%`;E.roundTable.dataset.mapZoomed=String(relative>1.015);E.mapZoomOutButton.disabled=relative<=1.015;E.mapZoomInButton.disabled=relative>=3.985;}
function resetMapView(){const m=mapMetrics();if(!m.viewportWidth||!m.viewportHeight)return;mapView.fitScale=mapFitScale();mapView.scale=mapView.fitScale;mapView.x=(m.viewportWidth-m.worldWidth*mapView.scale)/2;mapView.y=(m.viewportHeight-m.worldHeight*mapView.scale)/2;mapView.ready=true;applyMapView();}
function zoomMap(factor,point=null){if(!mapView.ready)resetMapView();const m=mapMetrics(),anchor=point||{x:m.viewportWidth/2,y:m.viewportHeight/2},oldScale=mapView.scale,newScale=Math.min(mapView.fitScale*4,Math.max(mapView.fitScale,oldScale*factor));const worldX=(anchor.x-mapView.x)/oldScale,worldY=(anchor.y-mapView.y)/oldScale;mapView.scale=newScale;mapView.x=anchor.x-worldX*newScale;mapView.y=anchor.y-worldY*newScale;applyMapView();}
function refitMapView(){
  const metrics = mapMetrics();
  if (!metrics.viewportWidth || !metrics.viewportHeight) return;
  if (!mapView.ready || E.roundTable.dataset.exploring !== "true") {
    resetMapView();
    return;
  }
  const relativeZoom = mapView.scale / mapView.fitScale;
  const centerX = (mapView.lastWidth / 2 - mapView.x) / mapView.scale;
  const centerY = (mapView.lastHeight / 2 - mapView.y) / mapView.scale;
  mapView.fitScale = mapFitScale();
  mapView.scale = mapView.fitScale * relativeZoom;
  mapView.x = metrics.viewportWidth / 2 - centerX * mapView.scale;
  mapView.y = metrics.viewportHeight / 2 - centerY * mapView.scale;
  applyMapView();
}
function mapPoint(event){const rect=E.roundTable.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
function rebaseMapGesture(){const points=[...mapView.pointers.values()];if(points.length>=2){const [a,b]=points,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));mapView.gesture={type:"pinch",distance,scale:mapView.scale,worldX:(mid.x-mapView.x)/mapView.scale,worldY:(mid.y-mapView.y)/mapView.scale};return;}if(points.length===1){const [point]=points;mapView.gesture={type:"pan",pointerId:point.id,startX:point.x,startY:point.y,originX:mapView.x,originY:mapView.y};return;}mapView.gesture=null;E.roundTable.dataset.mapDragging="false";}
function bindMapNavigation(){
  const exploreButton = $("exploreMapButton");
  const isExploring = () => E.roundTable.dataset.exploring === "true";
  exploreButton.onclick = () => {
    const exploring = !isExploring();
    E.roundTable.dataset.exploring = String(exploring);
    exploreButton.setAttribute("aria-pressed", String(exploring));
    exploreButton.textContent = exploring ? "返回总览" : "探索地图";
    mapView.pointers.clear();
    rebaseMapGesture();
    resetMapView();
    if (exploring) zoomMap(1.5);
  };
  const stop=(event)=>event.stopPropagation(),isUi=(event)=>event.target.closest(".map-controls,.quest-node,.quest-archive");E.mapControls.addEventListener("pointerdown",stop);E.mapZoomOutButton.onclick=()=>zoomMap(1/1.35);E.mapZoomInButton.onclick=()=>zoomMap(1.35);E.mapResetButton.onclick=resetMapView;E.roundTable.addEventListener("pointerdown",(event)=>{if(!isExploring()||E.roundTable.dataset.ceremonyActive==="true"||isUi(event))return;const point=mapPoint(event);mapView.pointers.set(event.pointerId,{id:event.pointerId,...point});E.roundTable.setPointerCapture?.(event.pointerId);rebaseMapGesture();event.preventDefault();});E.roundTable.addEventListener("pointermove",(event)=>{if(!mapView.pointers.has(event.pointerId))return;const point=mapPoint(event);mapView.pointers.set(event.pointerId,{id:event.pointerId,...point});const points=[...mapView.pointers.values()];if(points.length>=2&&mapView.gesture?.type==="pinch"){const [a,b]=points,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));mapView.scale=Math.min(mapView.fitScale*4,Math.max(mapView.fitScale,mapView.gesture.scale*distance/mapView.gesture.distance));mapView.x=mid.x-mapView.gesture.worldX*mapView.scale;mapView.y=mid.y-mapView.gesture.worldY*mapView.scale;E.roundTable.dataset.mapDragging="true";applyMapView();}else if(points.length===1&&mapView.gesture?.type==="pan"&&mapView.scale>mapView.fitScale*1.015){mapView.x=mapView.gesture.originX+point.x-mapView.gesture.startX;mapView.y=mapView.gesture.originY+point.y-mapView.gesture.startY;E.roundTable.dataset.mapDragging="true";applyMapView();}event.preventDefault();});const endPointer=(event)=>{mapView.pointers.delete(event.pointerId);rebaseMapGesture();};E.roundTable.addEventListener("pointerup",endPointer);E.roundTable.addEventListener("pointercancel",endPointer);E.roundTable.addEventListener("dblclick",(event)=>{if(!isExploring()||E.roundTable.dataset.ceremonyActive==="true"||isUi(event))return;zoomMap(mapView.scale>mapView.fitScale*1.8?mapView.fitScale/mapView.scale:1.8,mapPoint(event));});E.roundTable.addEventListener("wheel",(event)=>{if(!isExploring()||E.roundTable.dataset.ceremonyActive==="true"||!event.ctrlKey&&!event.metaKey)return;event.preventDefault();zoomMap(event.deltaY<0?1.18:1/1.18,mapPoint(event));},{passive:false});new ResizeObserver(()=>requestAnimationFrame(refitMapView)).observe(E.roundTable);}


function targetable(id){if(view.permissions.canPropose)return true;if(view.permissions.canUseLady)return view.permissions.ladyTargetIds.includes(id);if(view.permissions.canAssassinate)return id!==view.selfId;return false;}
function choosePlayer(id){if(view.permissions.canPropose){if(proposalPending)return;if(teamDraft.has(id))teamDraft.delete(id);else if(teamDraft.size<view.requiredTeamSize)teamDraft.add(id);render();return;}if(view.permissions.canUseLady&&view.permissions.ladyTargetIds.includes(id)){if(confirm(`让湖中仙女查验 ${nameOf(id)} 吗？`))submit({type:"ladyInspect",targetId:id});return;}if(view.permissions.canAssassinate&&id!==view.selfId&&confirm(`刺杀 ${nameOf(id)}？选择后立即结算。`))submit({type:"assassinate",targetId:id});}

function canManagePlayer(id){return canOpenPlayerAdminMenu({phase:view?.phase,canManage:view?.permissions?.canManage,selfId:view?.selfId,targetId:id});}
function closePlayerAdminMenu(){setHidden(E.playerAdminMenu,true);delete E.playerAdminMenu.dataset.targetId;E.players.querySelector(".admin-menu-open")?.classList.remove("admin-menu-open");}
function positionPlayerAdminMenu(anchor){
  const rect=anchor.getBoundingClientRect();setHidden(E.playerAdminMenu,false);E.playerAdminMenu.style.visibility="hidden";
  const width=E.playerAdminMenu.offsetWidth,height=E.playerAdminMenu.offsetHeight,gap=7,margin=8;
  const left=Math.max(margin,Math.min(window.innerWidth-width-margin,rect.left+rect.width/2-width/2));
  const below=rect.bottom+gap,top=below+height<=window.innerHeight-margin?below:Math.max(margin,rect.top-height-gap);
  E.playerAdminMenu.style.left=`${left}px`;E.playerAdminMenu.style.top=`${top}px`;E.playerAdminMenu.style.visibility="";
}
function openPlayerAdminMenu(id,anchor){if(!canManagePlayer(id)){closePlayerAdminMenu();choosePlayer(id);return;}closePlayerAdminMenu();E.playerAdminMenu.dataset.targetId=id;E.playerAdminMenuTitle.textContent=nameOf(id);anchor.classList.add("admin-menu-open");positionPlayerAdminMenu(anchor);E.removePlayerButton.focus({preventScroll:true});}
async function removeManagedPlayer(){
  const targetId=E.playerAdminMenu.dataset.targetId,target=player(targetId);if(!target||!canManagePlayer(targetId)){closePlayerAdminMenu();return;}
  if(!confirm(`确定将 ${target.name} 移出房间吗？\n该玩家当前的重连身份将失效，空出的席位可以由其他玩家加入。`))return;
  E.removePlayerButton.disabled=true;closePlayerAdminMenu();
  try{await room.kick(targetId);}catch(error){alert(`移出失败：${error.message}`);}finally{E.removePlayerButton.disabled=false;}
}

function closeQuestArchive(){setHidden(E.questArchive,true);delete E.questArchive.dataset.quest;}
function openQuestArchive(index,result){
  E.questArchive.dataset.quest=String(index+1);E.questArchiveKicker.textContent=`QUEST ${index+1} · EXPEDITION ARCHIVE`;E.questArchiveTitle.textContent=result.success?"远征凯旋":"远征覆灭";
  E.questArchiveSummary.textContent=`${result.team.length}名骑士参与 · ${result.successCount}张成功 · ${result.failCount}张失败`;
  E.questArchivePlayers.innerHTML=result.team.map((id)=>`<span class="quest-archive-player" style="--participant-color:${playerAccent(id)}"><i>${escapeHtml(playerInitial(id))}</i><b>${escapeHtml(nameOf(id))}</b></span>`).join("");
  setHidden(E.questArchive,false);
}
function renderQuests(){
  const existing=new Map([...E.questTrack.querySelectorAll(":scope > [data-quest]")].map((node)=>[node.dataset.quest,node]));
  Array.from({length:5},(_,i)=>{const result=view.questResults[i];const cls=result?result.success?"success":"fail":i===view.questIndex?"active":"pending";const size=({5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]})[view.capacity][i];const status=result?result.success?"远征成功":"远征失败":i===view.questIndex?"当前远征":"尚未启程";const mark=result?result.success?"✦":"✕":String(size),team=result?.team||[],renderKey=JSON.stringify([cls,size,status,mark,team]);let node=existing.get(String(i+1));if(!node){node=document.createElement("button");node.type="button";node.dataset.quest=String(i+1);}if(node.dataset.renderKey!==renderKey){node.dataset.renderKey=renderKey;node.className=`quest-node ${cls}`;node.title=`第${i+1}次远征 · ${size}人 · ${status}${result?" · 点击查看远征档案":""}`;node.innerHTML=`<span class="quest-order">QUEST ${i+1}</span><strong>${mark}</strong><span class="quest-size">${size}名骑士</span><small>${status}</small>${result?`<span class="quest-participants" aria-label="参与骑士">${team.map((id)=>`<i class="quest-participant" style="--participant-color:${playerAccent(id)}" title="${escapeHtml(nameOf(id))}">${escapeHtml(playerInitial(id))}</i>`).join("")}</span>`:""}`;}node.disabled=!result;node.onclick=result?()=>openQuestArchive(i,result):null;E.questTrack.append(node);existing.delete(String(i+1));});
  existing.forEach((node)=>node.remove());
  if(!E.questArchive.classList.contains("hidden")&&!view.questResults[Number(E.questArchive.dataset.quest)-1])closeQuestArchive();
  [...E.rejectTrack.children].forEach((node,i)=>{node.className=`reject-seal ${i<view.proposalNumber-1?"broken":""}`;});
  if(E.rejectTrack.children.length!==5)E.rejectTrack.innerHTML=Array.from({length:5},(_,i)=>`<span class="reject-seal ${i<view.proposalNumber-1?"broken":""}">${i+1}</span>`).join("");
}
function renderPlayers(){
  const existing=new Map([...E.players.querySelectorAll(":scope > [data-id]")].map((node)=>[node.dataset.id,node]));
  view.players.forEach((p,index)=>{const badges=createAvalonPlayerBadges({player:p,phase:view.phase,leaderId:view.leaderId,proposedTeam:view.proposedTeam,teamVoteProgress:view.teamVoteProgress,questProgress:view.questProgress,knownEvilIds:view.knownEvilIds,percivalCandidates:view.percivalCandidates,lastTeamVoteResult:view.lastTeamVoteResult});const inActiveExpedition=["questAction","questReveal"].includes(view.phase)&&view.proposedTeam.includes(p.id),manageable=canManagePlayer(p.id);const cls=["player-seat",p.id===view.leaderId?"leader":"",teamDraft.has(p.id)||inActiveExpedition?"selected":"",targetable(p.id)?"targetable":"",manageable?"manageable":"",p.connected?"":"offline"].join(" ");const renderKey=JSON.stringify([p,index,view.selfId,cls,badges]);let node=existing.get(p.id);if(!node){node=document.createElement("button");node.type="button";node.dataset.id=p.id;}if(node.dataset.renderKey!==renderKey){const presentationFocus=node.classList.contains("presentation-focus"),menuOpen=E.playerAdminMenu.dataset.targetId===p.id,initial=escapeHtml([...p.name][0]||"骑");node.dataset.renderKey=renderKey;node.className=cls;if(presentationFocus)node.classList.add("presentation-focus");if(menuOpen)node.classList.add("admin-menu-open");node.style.setProperty("--seat-index",String(index));node.style.setProperty("--player-accent",playerAccent(p.id));node.setAttribute("aria-haspopup",manageable?"menu":"false");node.innerHTML=`<span class="player-avatar" aria-hidden="true"><i>${initial}</i></span><span class="player-copy"><h3>${escapeHtml(p.name)}${p.id===view.selfId?" · 你":""}</h3><p>${p.connected?"在线":"离线"}${p.isHost?" · 房主":""}</p><small>${badges.map((badge)=>escapeHtml(badge.label)).join(" · ")||"身份隐藏"}</small></span><span class="player-badges">${badges.map(badgeHtml).join("")}</span>`;node.onclick=(event)=>openPlayerAdminMenu(p.id,event.currentTarget);}E.players.append(node);existing.delete(p.id);});
  existing.forEach((node)=>node.remove());
  $("rosterNotes").replaceChildren(...[...E.players.children].flatMap(seat => {
    const name = document.createElement("dt");
    const info = document.createElement("dd");
    name.textContent = seat.querySelector("h3").textContent;
    info.textContent = [".player-copy p", ".player-copy small"].map(selector => seat.querySelector(selector).textContent).join(" · ");
    return [name, info];
  }));
  const managedId=E.playerAdminMenu.dataset.targetId;if(managedId&&(!player(managedId)||!canManagePlayer(managedId)))closePlayerAdminMenu();
}

function renderFocus(){
  E.focusLabel.textContent="COUNCIL STATUS";
  if(view.phase==="lobby"){E.focusText.textContent=`等待骑士 ${view.players.length}/${view.capacity}`;E.focusHint.textContent=`${PRESET_LABEL[view.preset]}角色预设 · ${PACE_LABEL[view.paceMode]||"标准"}节奏 · 湖中仙女${view.ladyEnabled?"开启":"关闭"}`;return;}
  if(view.phase==="secretReveal"){E.focusText.textContent="密封纹章已经发放";E.focusHint.textContent=`${view.players.filter((p)=>p.secretAcknowledged).length}/${view.players.length}人已确认`;return;}
  if(view.phase==="teamProposal"){E.focusText.textContent=view.proposalExtension.requested?"圆桌正在表决是否延长讨论":`${nameOf(view.leaderId)}正在立下远征誓约`;E.focusHint.textContent=view.proposalExtension.requested?`${view.proposalExtension.voteProgress.length}/${view.players.length}人已表决 · 需${view.proposalExtension.required}票同意`:`第${view.questIndex+1}次远征需要${view.requiredTeamSize}人`;return;}
  if(view.phase==="teamVote"){E.focusText.textContent=`审议：${view.proposedTeam.map(nameOf).join("、")}`;E.focusHint.textContent=`${view.teamVoteProgress.length}/${view.players.length}票已封存`;return;}
  if(view.phase==="questAction"){E.focusText.textContent="远征队员正在向圣杯投牌";E.focusHint.textContent=`${view.questProgress.length}/${view.proposedTeam.length}张已封存 · 需${view.requiredFails}张失败牌`;return;}
  if(view.phase==="questReveal"){E.focusText.textContent="圣杯正在揭晓远征命运";E.focusHint.textContent=`已揭晓${view.ceremony?.revealedCards.length||0}/${view.ceremony?.cardCount||0}张匿名任务牌`;return;}
  if(view.phase==="ladyInspect"){E.focusText.textContent=`${nameOf(view.ladyHolderId)}持有湖中仙女`;E.focusHint.textContent="查验结果不会公开";return;}
  if(view.phase==="assassination"){E.focusText.textContent=`刺客 ${nameOf(view.assassinId)} 正在寻找梅林`;E.focusHint.textContent="一次选择将决定王国命运";return;}
  if(view.phase==="assassinationReveal"){E.focusText.textContent=`${nameOf(view.ceremony?.assassinId)}锁定了${nameOf(view.ceremony?.targetId)}`;E.focusHint.textContent="命运之刃即将揭晓王国归属";return;}
  E.focusLabel.textContent="THE LEGEND IS WRITTEN";E.focusText.textContent=`${view.result.winner==="good"?"正义":"邪恶"}阵营获胜`;E.focusHint.textContent=view.result.reason;
}

function renderSecret(role){const show=role==="player"&&view.phase!=="lobby";setHidden(E.secretPanel,!show);if(!show)return;if(E.secretPanel.dataset.phase!==view.phase){E.secretPanel.open=view.phase==="secretReveal";E.secretPanel.dataset.phase=view.phase;}E.secretRole.textContent=ROLE_LABEL[view.selfRole]||"身份等待发放";const pieces=[];if(view.selfRole==="merlin")pieces.push(`你看到的邪恶：${view.knownEvilIds.map(nameOf).join("、")||"无"}。莫德雷德与奥伯伦不会显现。`);if(view.selfRole==="percival")pieces.push(`梅林候选：${view.percivalCandidates.map(nameOf).join("、")}，其中可能混有莫甘娜。`);if(["assassin","morgana","mordred","minion"].includes(view.selfRole))pieces.push(`你知道的邪恶同伴：${view.knownEvilIds.map(nameOf).join("、")||"无"}。奥伯伦不会显现。`);if(view.selfRole==="oberon")pieces.push("你属于邪恶，但你与其他邪恶角色互不认识，梅林也看不到你。");if(["loyal"].includes(view.selfRole))pieces.push("你没有额外身份线索，请从组队、投票和任务结果中判断。");if(view.myLadyFinding)pieces.push(`你最近查验了${nameOf(view.myLadyFinding.targetId)}：显示为${view.myLadyFinding.displayedAlignment==="good"?"正义":"邪恶"}。`);E.secretKnowledge.textContent=pieces.join(" ");}

function renderActions(role){
  E.actionButtons.innerHTML="";
  if(view.phase==="questReveal"){E.actionTitle.textContent="远征结果正在揭晓";E.actionHint.textContent="任务牌已经由服务器匿名混洗，将逐张公开。";return;}
  if(view.phase==="assassinationReveal"){E.actionTitle.textContent="最终刺杀正在执行";E.actionHint.textContent=`刺客已经锁定${nameOf(view.ceremony?.targetId)}，等待命运裁决。`;return;}
  if(role==="spectator"){E.actionTitle.textContent="旁观卡美洛密议";E.actionHint.textContent="你可以看到所有公共提案、投票和远征结果，但不会获得角色或秘密选择。";return;}
  if(view.phase==="lobby"){E.actionTitle.textContent="等待圆桌集结";E.actionHint.textContent=`当前${view.players.length}/${view.capacity}人，房主可在顶部设置角色、节奏与湖中仙女。`;return;}
  if(view.phase==="secretReveal"){E.actionTitle.textContent=view.permissions.canAcknowledge?"阅读你的密封纹章":"等待其他骑士确认";E.actionHint.textContent="确认只代表你已看清身份，不会向其他人公开角色。";if(view.permissions.canAcknowledge)addButton("我已确认身份",()=>submit({type:"acknowledgeSecret"}),"primary");return;}
  if(view.phase==="teamProposal"){
    if(view.permissions.canPropose){
      const summary=document.createElement("div");summary.className="team-selection-summary";
      summary.textContent=`已选队员 ${teamDraft.size}/${view.requiredTeamSize}：${[...teamDraft].map(nameOf).join("、")||"尚未选择"}`;
      E.actionButtons.append(summary);
    }
    E.actionTitle.textContent=view.proposalExtension.requested?"是否延长本次组队讨论？":view.permissions.canPropose?`选择${view.requiredTeamSize}名远征队员`:`等待队长 ${nameOf(view.leaderId)} 组队`;
    E.actionHint.textContent=view.proposalExtension.requested?`严格多数同意后增加60秒；已有${view.proposalExtension.yes}票同意、${view.proposalExtension.no}票反对。`:view.permissions.canPropose?`已选择${teamDraft.size}/${view.requiredTeamSize}人，点击玩家纹章增删；选择会在普通状态刷新后保留。`:`这是本任务第${view.proposalNumber}/5次提案。`;
    if(view.permissions.canVoteExtension){addButton("同意延长",()=>submit({type:"voteDiscussionExtension",approve:true}),"primary");addButton("反对延长",()=>submit({type:"voteDiscussionExtension",approve:false}));}
    if(view.permissions.canPropose){const b=addButton(proposalPending?"正在提交队伍…":"确认远征队伍",proposeTeam,"primary");b.disabled=proposalPending||teamDraft.size!==view.requiredTeamSize;}
    if(view.permissions.canRequestExtension){const b=addButton("申请延长（最后30秒开放）",()=>submit({type:"requestDiscussionExtension"}));b.dataset.extensionRequest="";b.disabled=lastCountdownSeconds>30||lastCountdownSeconds<=0;b.title="仅在组队倒计时最后30秒可申请，本轮限一次";}
    return;
  }
  if(view.phase==="teamVote"){E.actionTitle.textContent="是否同意这支远征队伍？";E.actionHint.textContent=view.permissions.canTeamVote?`提案队伍：${view.proposedTeam.map(nameOf).join("、")}。收齐后公开票型。`:`已封存${view.teamVoteProgress.length}/${view.players.length}票。`;if(view.permissions.canTeamVote){addButton("同意提案",()=>submit({type:"submitTeamVote",approve:true}),"primary");addButton("反对提案",()=>submit({type:"submitTeamVote",approve:false}));}return;}
  if(view.phase==="questAction"){E.actionTitle.textContent=view.permissions.canQuest?"秘密提交任务牌":"等待远征队员提交任务牌";E.actionHint.textContent=view.permissions.canQuest?"任务牌由服务器匿名混洗，其他人无法知道你的选择。":`${view.questProgress.length}/${view.proposedTeam.length}张已投入圣杯。`;if(view.permissions.canQuest){addButton("任务成功",()=>submit({type:"submitQuestCard",card:"success"}),"primary");if(view.permissions.canFailQuest)addButton("破坏任务",()=>submit({type:"submitQuestCard",card:"fail"}),"danger");}return;}
  if(view.phase==="ladyInspect"){E.actionTitle.textContent=view.permissions.canUseLady?"选择一名玩家秘密查验":"等待湖中仙女完成查验";E.actionHint.textContent=view.permissions.canUseLady?"点击发光的玩家纹章。只有你会看到其显示阵营。":`${nameOf(view.ladyHolderId)}正在查验。`;return;}
  if(view.phase==="assassination"){E.actionTitle.textContent=view.permissions.canAssassinate?"指出你认为是梅林的玩家":"刺客正在寻找梅林";E.actionHint.textContent=view.permissions.canAssassinate?"点击任意其他玩家纹章并确认。":"邪恶仍有最后一次翻盘机会。";return;}
  E.actionTitle.textContent=`${view.result.winner==="good"?"正义":"邪恶"}阵营获胜`;E.actionHint.textContent=view.result.reason;
}

function renderRoom(){
  setHidden(E.hostTools,!view.permissions.canManage);setHidden(E.startGameButton,!view.permissions.canStart);setHidden(E.nextMatchButton,!view.permissions.canNextMatch);setHidden(E.endGameButton,!view.permissions.canEnd);
  E.roomPlayerCountSelect.value=String(view.capacity);E.roomPlayerCountSelect.disabled=!view.permissions.canConfigure;E.roomPresetSelect.value=view.preset;E.roomPresetSelect.disabled=!view.permissions.canConfigure;
  E.paceModeSelect.value=view.paceMode;E.paceModeSelect.disabled=!view.permissions.canConfigure;setHidden(E.customPaceButton,view.paceMode!=="custom");E.customPaceButton.disabled=!view.permissions.canConfigure;E.ladySettingButton.disabled=!view.permissions.canConfigure||view.capacity<7;E.ladySettingButton.textContent=`湖中仙女：${view.ladyEnabled?"开启":"关闭"}`;
}
function renderStatus(model){E.controlDock.dataset.role=model.memberRole;E.phaseTitle.textContent=PHASE_LABEL[view.phase]||"服务器结算中";}
function renderLog(){E.logList.innerHTML=view.logs.map((entry)=>`<p>${escapeHtml(entry.text)}</p>`).join("")||"<p>尚无编年记录。</p>";}
function ceremonyPortrait(id,kind){const player=view.players.find((item)=>item.id===id),initial=escapeHtml([...(player?.name||"?")][0]||"?");return`<article class="ceremony-person ${kind}" data-ceremony-player="${escapeHtml(id)}"><span>${initial}</span><b>${escapeHtml(player?.name||"玩家")}</b><small>${kind==="assassin"?"刺客":"被选中的骑士"}</small></article>`;}
function animateCeremonyCast(ceremony){requestAnimationFrame(()=>E.ceremonyCast.querySelectorAll("[data-ceremony-player]").forEach((node)=>{const source=seat(node.dataset.ceremonyPlayer);if(!source)return;const from=source.getBoundingClientRect(),to=node.getBoundingClientRect();node.style.setProperty("--enter-x",`${from.left+from.width/2-to.left-to.width/2}px`);node.style.setProperty("--enter-y",`${from.top+from.height/2-to.top-to.height/2}px`);node.classList.add("entering");}));}
function renderCeremony(){const ceremony=view.ceremony;if(!ceremony){setHidden(E.criticalCeremony,true);E.roundTable.dataset.ceremonyActive="false";delete E.criticalCeremony.dataset.ceremonyId;return;}setHidden(E.criticalCeremony,false);E.roundTable.dataset.ceremonyActive="true";E.criticalCeremony.dataset.kind=ceremony.kind;E.criticalCeremony.dataset.stage=ceremony.stage;const isNew=E.criticalCeremony.dataset.ceremonyId!==ceremony.id;E.criticalCeremony.dataset.ceremonyId=ceremony.id;E.ceremonyVerdict.className="ceremony-verdict";if(ceremony.kind==="quest"){E.ceremonyKicker.textContent=`QUEST ${ceremony.questNumber} · THE SEALED CHALICE`;E.ceremonyTitle.textContent=ceremony.stage==="sealed"?"圣杯封存了所有任务牌":ceremony.stage==="cards"?"远征誓言逐一显现":"远征命运已经定局";E.ceremonyHint.textContent=ceremony.stage==="sealed"?"牌面正在匿名混洗，无法追踪任何骑士的选择":ceremony.stage==="cards"?`已揭晓 ${ceremony.revealedCards.length}/${ceremony.cardCount} 张 · ${ceremony.requiredFails}张失败牌将令任务失败`:`共出现${ceremony.failCount}张失败牌`;if(isNew){E.ceremonyCast.innerHTML=`<div class="quest-party">${ceremony.teamIds.map((id)=>`<span>${escapeHtml(nameOf(id))}</span>`).join("")}</div>`;E.ceremonyCards.innerHTML=Array.from({length:ceremony.cardCount},(_,index)=>`<article class="quest-reveal-card sealed" data-card-index="${index}"><div><span class="card-back">✦</span><span class="card-face"></span></div></article>`).join("");}E.ceremonyCards.querySelectorAll("[data-card-index]").forEach((card,index)=>{const value=ceremony.revealedCards[index];card.className=`quest-reveal-card ${value||"sealed"}`;card.querySelector(".card-face").textContent=value==="fail"?"背叛":"忠诚";});E.ceremonyVerdict.textContent=ceremony.stage==="verdict"?(ceremony.success?"远征成功":"远征失败"):"";if(ceremony.stage==="verdict")E.ceremonyVerdict.classList.add(ceremony.success?"good":"evil");return;}E.ceremonyKicker.textContent="THE LAST JUDGEMENT · ASSASSINATION";E.ceremonyTitle.textContent=ceremony.stage==="approach"?"刺客已经锁定目标":ceremony.stage==="strike"?"命运之刃落下":"王国命运揭晓";E.ceremonyHint.textContent=ceremony.stage==="approach"?"两道身影走入卡美洛中央":ceremony.stage==="strike"?"这一击将决定梅林与王国的命运":ceremony.hit?"梅林的身份被刺客识破":"刺客选错了目标，梅林得以幸存";if(isNew){E.ceremonyCast.innerHTML=ceremonyPortrait(ceremony.assassinId,"assassin")+'<span class="ceremony-blade" aria-hidden="true">†</span>'+ceremonyPortrait(ceremony.targetId,"target");E.ceremonyCards.innerHTML="";animateCeremonyCast(ceremony);}E.ceremonyVerdict.textContent=ceremony.stage==="verdict"?(ceremony.hit?"梅林陨落 · 邪恶获胜":"刺杀落空 · 正义获胜"):"";if(ceremony.stage==="verdict")E.ceremonyVerdict.classList.add(ceremony.hit?"evil":"good");}
function renderCountdownPartition(){
  if(view.deadline)countdown.start(view.deadline,Math.max(1,Number(view.deadlineDurationSeconds)||30)*1000);else{countdown.stop();lastCountdownSeconds=0;E.timerText.textContent="--";E.timerBar.style.width="0";}
}
const partitionRenderer=createGame22PartitionRenderer({room:renderRoom,status:renderStatus,quests:renderQuests,players:renderPlayers,focus:renderFocus,secret:(model)=>renderSecret(model.memberRole),decision:(model)=>renderActions(model.memberRole),ceremony:renderCeremony,log:renderLog,countdown:renderCountdownPartition});
function render(){if(!view)return;teamDraftStore.save(draftContext,[...teamDraft]);const spectatorModel=spectatorUi.render(view);partitionRenderer.render(createGame22RenderModel(view,{memberRole:spectatorModel.memberRole,roomCode:room.snapshot().roomCode,teamDraft,proposalPending}));}

function seat(id){return E.players.querySelector(`[data-id="${CSS.escape(String(id))}"]`);}function labelFor(event){return ({"match-start":"密议开启","leader-turn":"队长誓约","team-proposed":"远征提案","team-vote-sealed":"蜡印封存","team-vote-result":"圆桌裁决","quest-card-sealed":"圣杯收牌","quest-result":"远征结算","lady-ready":"湖光苏醒","lady-inspect":"湖中仙女","assassination-start":"刺客现身","discussion-extension-requested":"延时动议","discussion-extension-granted":"动议通过","discussion-extension-rejected":"动议驳回","game-result":"王国命运"})[event.kind]||"卡美洛动态";}
function beforePlay(event){const source=seat(event.actorId)||E.roundTable.querySelector(".table-focus"),target=seat(event.targetId)||(event.targetIds||[]).map(seat).find(Boolean)||E.roundTable.querySelector(".table-focus");const highlighted=[...new Set([source,target,...(event.targetIds||[]).map(seat)].filter(Boolean))];highlighted.forEach((el)=>el.classList.add("presentation-focus"));let token=null;if(source&&target&&source!==target){const stage=E.presentationEffects.getBoundingClientRect(),a=source.getBoundingClientRect(),b=target.getBoundingClientRect();token=document.createElement("span");token.className="presentation-token";token.style.left=`${a.left+a.width/2-stage.left}px`;token.style.top=`${a.top+a.height/2-stage.top}px`;token.style.setProperty("--to-x",`${b.left+b.width/2-stage.left}px`);token.style.setProperty("--to-y",`${b.top+b.height/2-stage.top}px`);E.presentationEffects.append(token);}return()=>{highlighted.forEach((el)=>el.classList.remove("presentation-focus"));token?.remove();};}
presentation=createPresentationTimeline({container:E.presentationEffects,trailPath:E.presentationTrail,announcement:E.presentationAnnouncement,labelElement:E.presentationLabel,textElement:E.presentationText,effectsElement:E.presentationEffects,resolveSource:(event)=>seat(event.actorId),resolveTarget:(event)=>seat(event.targetId)||E.roundTable.querySelector(".table-focus"),labelFor,beforePlay,durationMs:1350,reducedDurationMs:500,maxQueue:18,sceneKey:(event)=>event.sceneId||event.id,priorityFor:(event)=>Number(event.priority)||0,catchUpThreshold:2,severeBacklogThreshold:5,catchUpDurationMs:620,severeDurationMs:300,urgentPriority:4,retainPriority:3});

function fillCounts(select){select.innerHTML=Array.from({length:6},(_,i)=>`<option value="${i+5}" ${i===2?"selected":""}>${i+5}</option>`).join("");}
async function init(){
  fillCounts(E.playerCountSelect);fillCounts(E.roomPlayerCountSelect);roomEntry.bind();bindMapNavigation();
  E.questArchiveClose.onclick=closeQuestArchive;
  const volume = E.roomPanel.querySelector("[data-play-reference]");
  volume.addEventListener("keydown", event => {
    if (event.key === "Escape" && volume.open) {
      volume.open = false;
      volume.querySelector("summary").focus();
    }
  });
  E.removePlayerButton.onclick=removeManagedPlayer;
  document.addEventListener("pointerdown",(event)=>{if(!E.playerAdminMenu.classList.contains("hidden")&&!event.target.closest("#playerAdminMenu,.player-seat"))closePlayerAdminMenu();});
  document.addEventListener("keydown",(event)=>{if(event.key==="Escape")closePlayerAdminMenu();});
  window.addEventListener("resize",closePlayerAdminMenu);window.addEventListener("scroll",closePlayerAdminMenu,true);
  E.roomPlayerCountSelect.onchange=()=>submit({type:"setCapacity",capacity:Number(E.roomPlayerCountSelect.value)});E.roomPresetSelect.onchange=()=>submit({type:"setPreset",preset:E.roomPresetSelect.value});
  E.paceModeSelect.onchange=async()=>{const paceMode=E.paceModeSelect.value;if(paceMode==="custom"){openCustomPaceDialog();return;}await submit({type:"setPace",paceMode});};
  E.customPaceButton.onclick=openCustomPaceDialog;
  E.saveCustomPaceButton.onclick=async()=>{const result=await submit({type:"setPace",paceMode:"custom",timers:customTimersFromInputs()});if(result)E.customPaceDialog.close();};
  E.customPaceDialog.addEventListener("close",()=>{if(view)E.paceModeSelect.value=view.paceMode;});
  E.ladySettingButton.onclick=()=>submit({type:"setLadyEnabled",enabled:!view.ladyEnabled});E.startGameButton.onclick=()=>submit({type:"start"});E.nextMatchButton.onclick=()=>submit({type:"nextMatch"});
  E.endGameButton.onclick=()=>{if(confirm("确定结束当前卡美洛密议并让所有人返回准备大厅吗？\n当前身份、投票、任务和比分进度将被清空。"))submit({type:"end"});};
  E.toggleLogButton.onclick=()=>{const collapsed=E.logList.classList.toggle("collapsed");E.toggleLogButton.textContent=collapsed?"展开":"收起";};spectatorUi.bind();try{spectatorUi.applyConfig(await room.checkServer());}catch{/* 创建或加入时再提示 */}
}
init();
