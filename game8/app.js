"use strict";

import { bindRoomCodeInput, cleanPlayerName, createRoomClient, createSessionStore, escapeHtml, renderConnectionStatus, setHidden, setModeVisibility } from "/shared/client/index.js";

const Engine=window.Engine, PROTOCOL_VERSION=2, COLORS=Engine.COLORS, TIER_KEYS=["stage3","stage2","stage1"];
const BALL_FILES={red:"red.png",blue:"blue.png",black:"black.png",pink:"pink.png",yellow:"yellow.png",purple:"master.png"};
const BALL_NAMES={red:"精灵球",blue:"超级球",black:"高级球",pink:"治愈球",yellow:"先机球",purple:"大师球"};
const $=(id)=>document.getElementById(id);
const E=Object.fromEntries(["connectionStatus","setupPanel","roomPanel","hostModeButton","guestModeButton","hostSetup","guestSetup","hostNameInput","guestNameInput","playerCountSelect","createRoomButton","joinRoomButton","roomCodeInput","roomCodeDisplay","hostTools","roomPlayerCountSelect","startGameButton","endGameButton","playerBadge","players","logList","toggleLogButton","notice","tokens","rareMarket","legendMarket","rareCount","legendCount","markets","actionTitle","phaseBadge","selectionSummary","actionArea","myScore","myResources","myPokemon","myReserved","reserveCount"].map((id)=>[id,$(id)]));
let mode="host",state=null,guestView=null,cards=[],byId={},selection=[],selectedCardId=null;

const sessions=createSessionStore({gameId:"pokemon-splendor"});
const room=createRoomClient({protocolVersion:PROTOCOL_VERSION,sessionStore:sessions,
  onStatus(status){renderConnectionStatus(E.connectionStatus,status,room.snapshot().roomCode);},
  handlers:{onHello:admitPlayer,onPresence:updatePresence,onAction:receiveAction,onView(view){guestView=view;enterRoom();render();},onRejected(message){alert(message||"房主拒绝了加入请求。");},onKicked(){alert("你已被房主移出房间。");location.reload();}}
});
const makePlayer=(id,name,isHost=false)=>({id,name,isHost,connected:true});
const makeLobby=(capacity,host)=>({phase:"lobby",capacity,players:[host],game:null});
const roomInfo=()=>room.snapshot();
const viewerSeat=(viewerId)=>state.players.findIndex((p)=>p.id===viewerId);
const currentView=()=>mode==="host"?(state?buildView(roomInfo().playerId):null):guestView;
function enterRoom(){setHidden(E.setupPanel,true);setHidden(E.roomPanel,false);setHidden(E.hostTools,mode!=="host");E.roomCodeDisplay.textContent=roomInfo().roomCode;}
function sync(){render();broadcast();}
function broadcast(){if(mode!=="host"||!state)return;for(const p of state.players)if(!p.isHost)room.sendView(p.id,buildView(p.id)).catch(()=>{});}
function buildView(viewerId){const seat=viewerSeat(viewerId);return{phase:state.phase,capacity:state.capacity,players:state.players,viewerId,game:state.game?Engine.redactFor(state.game,seat):null};}
function submit(action){selection=[];selectedCardId=null;if(mode==="host")receiveAction(roomInfo().playerId,action);else room.submitAction(action).catch((error)=>alert(`操作发送失败：${error.message}`));}

async function createGameRoom(){try{const name=cleanPlayerName(E.hostNameInput.value,"房主"),result=await room.createRoom({name});state=makeLobby(Number(E.playerCountSelect.value),makePlayer(result.playerId,name,true));E.roomPlayerCountSelect.value=state.capacity;enterRoom();render();}catch(error){alert(`创建失败：${error.message}\n请运行 node game8/signal-server.js`);}}
async function joinGameRoom(){try{await room.joinRoom({code:E.roomCodeInput.value,name:E.guestNameInput.value});E.connectionStatus.textContent="已连接，等待房主同步";}catch(error){alert(`加入失败：${error.message}`);}}
function admitPlayer(id,payload){if(!state||mode!=="host")return;const old=state.players.find((p)=>p.id===id);if(old){old.connected=true;return sync();}if(state.phase!=="lobby")return room.reject(id,"游戏已经开始，不能中途加入。");if(state.players.length>=state.capacity)return room.reject(id,"房间人数已满。");state.players.push(makePlayer(id,cleanPlayerName(payload.name,"训练家")));sync();}
function updatePresence(id,connected){const p=state?.players.find((x)=>x.id===id);if(p&&p.connected!==connected){p.connected=connected;sync();}}
function changeCapacity(){const n=Number(E.roomPlayerCountSelect.value);if(n<state.players.length){E.roomPlayerCountSelect.value=state.capacity;return alert("人数不能少于已加入玩家。");}state.capacity=n;sync();}
function startGame(){if(state.players.length!==state.capacity)return alert(`需要 ${state.capacity} 位训练家到齐。`);if(state.players.some((p)=>!p.connected))return alert("请等待所有训练家恢复连接。");state.game=Engine.createGame(cards,{numPlayers:state.capacity,names:state.players.map((p)=>p.name)});state.phase="playing";sync();}
function resetLobby(){state.phase="lobby";state.game=null;selection=[];selectedCardId=null;sync();}
function endGame(){if(state.phase==="ended"||confirm("确定结束本局并返回大厅吗？"))resetLobby();}
function receiveAction(playerId,action){if(mode!=="host"||state?.phase!=="playing")return;const seat=viewerSeat(playerId);if(seat<0)return;const result=Engine.applyAction(state.game,action,seat);if(!result.ok){if(playerId===roomInfo().playerId)alert(result.error);else room.reject(playerId,result.error);return;}if(state.game.phase==="gameover")state.phase="ended";sync();}

const card=(id)=>typeof id==="string"?byId[id]:null;
const orbHtml=(color,n)=>`<span class="orb ${color}"><img src="${BALL_FILES[color]}" alt="${BALL_NAMES[color]}"><b>${n}</b></span>`;
function cardHtml(value,ctx="market"){
  if(!value)return '<div class="placeholder">牌位为空</div>';
  if(typeof value==="object"&&value.hidden)return '<article class="poke-card"><div class="art">?</div><div class="name">秘密保留卡</div></article>';
  const c=typeof value==="string"?card(value):value;if(!c)return"";
  const costs=Engine.ALL_TOKENS.filter((x)=>c.cost[x]>0).map((x)=>orbHtml(x,c.cost[x])).join("")||"免费";
  const selected=selectedCardId===c.id;
  const canReserve=ctx!=="reserved"&&["stage1","stage2","stage3"].includes(c.tier);
  const quickActions=selected?`<div class="card-quick-actions"><button class="primary" data-card-action="capture" data-card-id="${c.id}">捕捉</button>${canReserve?`<button data-card-action="reserve" data-card-id="${c.id}">保留</button>`:""}</div>`:"";
  return `<article class="poke-card ${selected?"selected":""}" data-card="${c.id}" data-context="${ctx}" style="--card:${{red:"#ffd7d9",black:"#d9dbea",yellow:"#fff2ad",pink:"#ffd9ec",blue:"#d7e8ff"}[c.bonus]}">${quickActions}<img class="card-face" src="${escapeHtml(c.img)}" alt="${escapeHtml(c.name)}"><div class="name"><span>${escapeHtml(c.name)}</span><span class="points">🏆${c.vp}</span></div><div class="cost">${costs}</div>${c.evolvesTo?`<div class="evo">可进化为 ${escapeHtml(c.evolvesTo)} · ${BALL_NAMES[c.evoCost.color]}×${c.evoCost.count}</div>`:""}</article>`;
}
const playerStats=(g,p)=>({score:Engine.scoreOf(g,p),bonuses:Engine.bonuses(g,p),tokens:Engine.tokenTotal(p)});
function render(){
  const v=currentView();if(!v)return;const seat=v.players.findIndex((p)=>p.id===v.viewerId),g=v.game;
  // 网络视图会删除静态数据库，客户端用本地同版本数据重新挂载，只用于计算与渲染。
  if(g&&!g.byId){g.byId=byId;g.cardDB=cards;}
  const me=g?.players[seat],turn=g?.players[g.turn],myTurn=v.phase==="playing"&&g.turn===seat;
  E.roomCodeDisplay.textContent=roomInfo().roomCode;E.roomPlayerCountSelect.value=v.capacity;E.playerBadge.textContent=`${v.players.length} / ${v.capacity}`;E.startGameButton.disabled=v.phase!=="lobby";setHidden(E.startGameButton,v.phase!=="lobby");E.endGameButton.textContent=v.phase==="ended"?"返回大厅":"结束游戏";
  E.players.innerHTML=v.players.map((rp,i)=>{const gp=g?.players[i],s=gp?playerStats(g,gp):null;return `<div class="player ${g&&i===g.turn&&v.phase==="playing"?"turn":""} ${i===seat?"me":""}"><div class="player-top"><span>${escapeHtml(rp.name)} ${rp.isHost?"★":""} ${rp.connected?"":"(离线)"}</span><span>🏆 ${s?.score||0}</span></div><div class="player-meta">${s?`奖励 ${COLORS.map((c)=>orbHtml(c,s.bonuses[c])).join(" ")} · 球 ${s.tokens} · 保留 ${gp.reserve.length} · 进化 ${gp.buried.length}`:"等待开始"}</div></div>`;}).join("");
  if(!g){renderLobby(v);return;}
  E.logList.innerHTML=[...g.log].reverse().map((x)=>`<div>${escapeHtml(x.msg)}</div>`).join("")||"<div>暂无记录</div>";
  E.tokens.innerHTML=Engine.ALL_TOKENS.map((c)=>`<button class="token ${c} ${selection.includes(c)?"selected":""}" data-token="${c}" ${!myTurn||g.acted||c==="purple"?"disabled":""}><b>${g.supply[c]}</b><span>${BALL_NAMES[c]}</span></button>`).join("");
  E.rareCount.textContent=`牌库 ${g.decks.rare.length}`;E.legendCount.textContent=`牌库 ${g.decks.legend.length}`;E.rareMarket.innerHTML=g.field.rare.map((id)=>cardHtml(id)).join("");E.legendMarket.innerHTML=g.field.legend.map((id)=>cardHtml(id)).join("");
  E.markets.innerHTML=TIER_KEYS.map((tier)=>`<section class="market-row"><div class="deck" data-blind="${tier}"><b>${Engine.zhTier(tier)}</b><span>剩余 ${g.decks[tier].length}<br>点击暗中保留</span></div><div class="cards">${g.field[tier].map((id)=>cardHtml(id)).join("")}</div></section>`).join("");
  const ms=playerStats(g,me);E.myScore.innerHTML=`${ms.score} <small>奖杯</small>`;E.myResources.innerHTML=Engine.ALL_TOKENS.map((c)=>orbHtml(c,`${me.tokens[c]} + ${ms.bonuses[c]||0}`)).join("");E.myPokemon.innerHTML=me.board.map((id)=>cardHtml(id,"mine")).join("")||'<div class="placeholder">还没有捕捉宝可梦</div>';E.reserveCount.textContent=`${me.reserve.length} / 3`;E.myReserved.innerHTML=me.reserve.map((id)=>cardHtml(id,"reserved")).join("")||'<div class="placeholder">没有保留卡</div>';
  renderActions(v,g,me,myTurn,turn);bindBoard(g,me,myTurn);
}
function renderLobby(v){E.notice.textContent=`等待训练家加入（${v.players.length}/${v.capacity}）`;E.actionTitle.textContent="准备阶段";E.phaseBadge.textContent="大厅";E.tokens.innerHTML="";E.markets.innerHTML="";E.rareMarket.innerHTML="";E.legendMarket.innerHTML="";E.myPokemon.innerHTML="";E.myReserved.innerHTML="";E.myResources.innerHTML="";E.myScore.textContent="0";E.actionArea.innerHTML="";E.logList.innerHTML="<div>创建房间后等待所有训练家到齐。</div>";}
function renderActions(v,g,me,myTurn,turn){
  E.actionArea.innerHTML="";E.selectionSummary.textContent="";E.phaseBadge.textContent=v.phase==="ended"?"游戏结束":g.lastRound?"最后一轮":`第 ${g.round} 轮`;
  if(v.phase==="ended"){E.notice.textContent=`${g.players[g.winner].name} 获胜！`;E.actionTitle.textContent="挑战结束";return;}
  const ts=Engine.turnState(g);E.notice.textContent=myTurn?"轮到你行动":`等待 ${turn.name} 行动`;E.actionTitle.textContent=myTurn?"请选择操作":`当前训练家：${turn.name}`;if(!myTurn)return;
  if(ts.mustDiscard){E.actionTitle.textContent=`请归还 ${ts.mustDiscard} 个精灵球`;Engine.ALL_TOKENS.filter((c)=>me.tokens[c]>0).forEach((c)=>addButton(`归还一个${BALL_NAMES[c]}`,()=>submit({type:"discard",color:c})));return;}
  if(!g.acted){const need=Math.min(3,COLORS.filter((c)=>g.supply[c]>0).length);E.selectionSummary.textContent=selection.length?`已选择：${selection.map((c)=>BALL_NAMES[c]).join("、")}`:`选择 ${need} 种颜色，或同色两个`;addButton(`拿取 ${need} 种不同颜色`,()=>submit({type:"take",colors:selection}),selection.length!==need);if(selection.length===1&&g.supply[selection[0]]>=4)addButton(`拿取两个${BALL_NAMES[selection[0]]}`,()=>submit({type:"take",colors:[selection[0],selection[0]]}));return;}
  for(const opt of ts.evolutions)addButton(`进化：${card(opt.fromId).name} → ${card(opt.toId).name}`,()=>submit({type:"evolve",fromId:opt.fromId,toId:opt.toId}));addButton("结束回合",()=>submit({type:"endTurn"}));
}
function addButton(text,on,disabled=false){const b=document.createElement("button");b.textContent=text;b.disabled=disabled;b.onclick=on;E.actionArea.appendChild(b);}
function bindBoard(g,me,myTurn){
  E.tokens.querySelectorAll("[data-token]").forEach((b)=>b.onclick=()=>{const c=b.dataset.token;if(selection.includes(c))selection=selection.filter((x)=>x!==c);else if(selection.length<3)selection.push(c);render();});
  if(!myTurn||g.acted)return;
  document.querySelectorAll('.poke-card[data-card]:not([data-context="mine"])').forEach((el)=>el.onclick=(event)=>{event.stopPropagation();selectedCardId=el.dataset.card;render();});
  document.querySelectorAll("[data-card-action]").forEach((button)=>button.onclick=(event)=>{event.stopPropagation();const id=button.dataset.cardId;if(button.dataset.cardAction==="capture")submit({type:"capture",cardId:id});else submit({type:"reserve",target:{fromField:id}});});
  document.querySelectorAll("[data-blind]").forEach((el)=>el.onclick=()=>{if(confirm(`暗中保留${Engine.zhTier(el.dataset.blind)}牌堆顶卡？`))submit({type:"reserve",target:{fromDeck:el.dataset.blind}});});
}

async function init(){const response=await fetch("./data/cards.json");if(!response.ok)throw new Error("卡牌数据库加载失败");cards=await response.json();byId=Object.fromEntries(cards.map((c)=>[c.id,c]));E.hostModeButton.onclick=()=>{mode="host";setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});};E.guestModeButton.onclick=()=>{mode="guest";setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});};E.createRoomButton.onclick=createGameRoom;E.joinRoomButton.onclick=joinGameRoom;bindRoomCodeInput(E.roomCodeInput);E.roomPlayerCountSelect.onchange=changeCapacity;E.startGameButton.onclick=startGame;E.endGameButton.onclick=endGame;E.toggleLogButton.onclick=()=>E.logList.classList.toggle("collapsed");document.addEventListener("click",()=>{if(selectedCardId){selectedCardId=null;render();}});setModeVisibility(mode,{...E,hostButton:E.hostModeButton,guestButton:E.guestModeButton});room.checkServer().catch(()=>{});}
init().catch((error)=>{E.connectionStatus.textContent=error.message;console.error(error);});
