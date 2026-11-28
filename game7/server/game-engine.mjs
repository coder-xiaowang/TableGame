import {
  ACTION_SECONDS,BETS,DICE_SETTLED_MS,DICE_SLOWING_MS,GOOD_IDS,GOODS,MARKET_VALUES,
  PLAYER_COLORS,assertCapacity,randomStarts,rollForGood,shuffle
} from "../rules.mjs";
import {appendPresentationEvent,normalizePresentationState,validatePresentationState} from "../../shared/server/presentation-events.mjs";

export {ACTION_SECONDS};
export const STATE_VERSION=1;
export const SUPPORTS_SPECTATORS=true;
const PHASES=new Set(["lobby","auction","configure","placing","rolling","arrivalOrder","pilot","pirateBoard","plunder","yardOrder","settling","ended"]);
const clone=(value)=>structuredClone(value);

export class GameRuleError extends Error{
  constructor(code,message,status=400){super(message);this.name="GameRuleError";this.code=code;this.status=status;}
}
function fail(condition,code,message,status=400){if(condition)throw new GameRuleError(code,message,status);}
function checkedCapacity(value){try{return assertCapacity(value);}catch(error){throw new GameRuleError("invalid_capacity",error.message);}}
function byId(state,id){return state.players.find((player)=>player.id===String(id))||null;}
function requirePlayer(state,id){const player=byId(state,id);fail(!player,"not_a_player","你不在玩家席中。",403);return player;}
function requireHost(state,id){const player=requirePlayer(state,id);fail(!player.isHost,"host_required","只有房主可以执行此操作。",403);return player;}
function nameOf(state,id){return byId(state,id)?.name||"玩家";}
function setDeadline(state,now,milliseconds=ACTION_SECONDS*1000){state.deadline=now+milliseconds;}
function clearDeadline(state){state.deadline=0;}
function addLog(state,text,now){state.logs.unshift({id:`log_${++state.logSequence}`,text,at:now});state.logs=state.logs.slice(0,100);}
function nextScene(state){return`manila_scene_${++state.presentationSceneSequence}`;}
function present(state,kind,text,now,details={},sceneId=null){return appendPresentationEvent(state,{kind,text,priority:2,sceneId:sceneId||nextScene(state),...details},{now,idPrefix:"manila_event",limit:70});}
function nextRandomSeed(random){return(Math.floor(random()*0x100000000)>>>0)||1;}

function makePlayer(state,{id,name,isHost=false,connected=false}){
  fail(!id,"player_id_required","缺少玩家身份。");
  const used=new Set((state.players||[]).map((player)=>player.color)),color=PLAYER_COLORS.find((candidate)=>!used.has(candidate))||PLAYER_COLORS[(state.players?.length||0)%PLAYER_COLORS.length];
  return{id:String(id),name:String(name||"玩家").trim().slice(0,12)||"玩家",isHost:Boolean(isHost),connected:Boolean(connected),color,cash:30,shares:[],assistants:3};
}
function makeShare(state,good,{initial=false}={}){return{shareId:`share_${++state.shareSequence}`,good,initial:Boolean(initial),mortgaged:false};}
function activePlayerId(state){
  if(state.phase==="auction")return state.players[state.auctionTurn]?.id||null;
  if(["configure","arrivalOrder","yardOrder"].includes(state.phase))return state.harborMasterId;
  if(state.phase==="placing")return state.players[state.placeTurn]?.id||null;
  if(state.phase==="rolling"&&["ready","spinning"].includes(state.rollStage))return state.harborMasterId;
  if(state.phase==="pilot")return state.pending?.playerId||null;
  if(state.phase==="pirateBoard")return state.pending?.pirates?.[state.pending.pirateIndex]?.playerId||null;
  if(state.phase==="plunder"){const shipIndex=state.pending?.ships?.[state.pending?.choiceIndex||0];return state.pending?.piratesByShip?.[shipIndex]?.[0]?.playerId||null;}
  return null;
}
function resetVoyageState(state){
  Object.assign(state,{harborMasterId:null,previousMasterId:null,auctionStarter:0,auctionTurn:0,highBid:0,highBidder:null,passed:[],ships:[],placements:[],port:[],yard:[],pending:null,placementRound:0,placeTurn:0,rollStage:null,rollStartedAt:0,stopRequestedAt:0,settleAt:0,diceAnimationSeed:0,rollingShipIds:[],deadline:0,result:null});
}
function resetLobby(state){
  state.phase="lobby";state.voyage=0;state.market=Object.fromEntries(GOOD_IDS.map((good)=>[good,0]));state.stock=Object.fromEntries(GOOD_IDS.map((good)=>[good,5]));state.logs=[];state.logSequence=0;state.winnerIds=[];state.shareSequence=0;resetVoyageState(state);
  for(const player of state.players){player.cash=30;player.shares=[];player.assistants=3;}
}

export function createLobby({capacity,host}){
  const state={stateVersion:STATE_VERSION,capacity:checkedCapacity(capacity),players:[],phase:"lobby",voyage:0,stock:Object.fromEntries(GOOD_IDS.map((good)=>[good,5])),market:Object.fromEntries(GOOD_IDS.map((good)=>[good,0])),logs:[],logSequence:0,shareSequence:0,presentationEvents:[],presentationSequence:0,presentationSceneSequence:0,winnerIds:[]};
  state.players.push(makePlayer(state,{...host,isHost:true}));resetVoyageState(state);return state;
}
export function addPlayer(state,player){fail(state.phase!=="lobby","game_started","游戏开始后只能旁观。",409);fail(state.players.length>=state.capacity,"room_full","玩家席已满。",409);fail(byId(state,player.id),"duplicate_player","玩家已经在房间中。",409);state.players.push(makePlayer(state,player));}
export function removePlayer(state,actorId,playerId){requireHost(state,actorId);fail(state.phase!=="lobby","game_started","游戏开始后不能移出正式玩家。",409);const target=byId(state,playerId);fail(!target||target.isHost,"invalid_remove","不能移出该玩家。");state.players=state.players.filter((player)=>player.id!==target.id);}
export function canChangeSeats(state){return state.phase==="lobby";}
export function vacateSeat(state,playerId){fail(state.phase!=="lobby","seat_locked","游戏开始后不能离开玩家席。",409);const player=requirePlayer(state,playerId);fail(player.isHost,"host_must_play","房主必须留在玩家席。",403);state.players=state.players.filter((item)=>item.id!==player.id);}
export function setPresence(state,playerId,connected,{now=Date.now()}={}){const player=byId(state,playerId);if(!player||player.connected===Boolean(connected))return false;player.connected=Boolean(connected);if(!connected&&activePlayerId(state)===player.id&&state.deadline)state.deadline=Math.min(state.deadline,now+10000);return true;}

function dealInitialShares(state,random){
  const deck=shuffle(GOOD_IDS.flatMap((good)=>Array(3).fill(good)),random);state.shareSequence=0;
  for(const player of state.players){player.cash=30;player.shares=deck.splice(0,2).map((good)=>makeShare(state,good,{initial:true}));player.assistants=3;}
  state.stock=Object.fromEntries(GOOD_IDS.map((good)=>[good,5-state.players.flatMap((player)=>player.shares).filter((share)=>share.good===good).length]));
  state.market=Object.fromEntries(GOOD_IDS.map((good)=>[good,0]));
}
function startAuction(state,now,random){
  state.voyage+=1;Object.assign(state,{phase:"auction",ships:[],placements:[],port:[],yard:[],highBid:0,highBidder:null,passed:[],pending:null,placementRound:0,rollStage:null,rollingShipIds:[]});
  state.auctionStarter=state.previousMasterId?Math.max(0,state.players.findIndex((player)=>player.id===state.previousMasterId)):Math.floor(random()*state.players.length);state.auctionTurn=state.auctionStarter;setDeadline(state,now);
  addLog(state,`第 ${state.voyage} 次航行：开始竞拍港务长。`,now);present(state,"auction-start",`第 ${state.voyage} 次港务长竞拍开始`,now,{priority:3,voyage:state.voyage,actorId:state.players[state.auctionTurn]?.id||null});
}
function availableFunds(player){return player.cash+player.shares.filter((share)=>!share.mortgaged).length*12;}
function mortgageShare(player,share){fail(!share||share.mortgaged,"invalid_mortgage","这张股票不能抵押。",409);share.mortgaged=true;player.cash+=12;}
function redeemShare(player,share){fail(!share||!share.mortgaged,"invalid_redeem","这张股票没有抵押。",409);fail(player.cash<15,"insufficient_cash","现金不足，无法赎回股票。",409);share.mortgaged=false;player.cash-=15;}
function ensureCash(player,amount){while(player.cash<amount&&player.shares.some((share)=>!share.mortgaged))mortgageShare(player,player.shares.find((share)=>!share.mortgaged));}
function nextAuction(state,now){
  const alive=state.players.filter((player)=>!state.passed.includes(player.id));
  if(alive.length<=1){const winnerId=state.highBidder||alive[0]?.id||state.previousMasterId||state.players[0].id,player=byId(state,winnerId);if(state.highBid){ensureCash(player,state.highBid);player.cash-=state.highBid;}state.harborMasterId=winnerId;state.previousMasterId=winnerId;state.phase="configure";setDeadline(state,now);addLog(state,`${player.name}以 ${state.highBid} 比索成为港务长。`,now);present(state,"harbor-master",`${player.name}成为本航次港务长`,now,{priority:4,actorId:winnerId,bid:state.highBid});return;}
  for(let offset=1;offset<=state.players.length;offset+=1){const index=(state.auctionTurn+offset)%state.players.length;if(!state.passed.includes(state.players[index].id)){state.auctionTurn=index;break;}}
  setDeadline(state,now);
}
function configureShips(state,actor,action,now){
  const selected=[...new Set((action.goods||[]).map(String))],starts=(action.starts||[]).map(Number);fail(selected.length!==3||selected.some((good)=>!GOODS[good]),"invalid_goods","必须选择三种不同货物。");fail(starts.length!==3||starts.some((value)=>!Number.isInteger(value)||value<0||value>5)||starts.reduce((sum,value)=>sum+value,0)!==9,"invalid_starts","三艘船起点必须在0～5且总和为9。");
  const buyGood=action.buyGood?String(action.buyGood):null;if(buyGood){fail(!GOODS[buyGood]||state.stock[buyGood]<=0,"stock_unavailable","该股票已经售罄。",409);const price=Math.max(5,MARKET_VALUES[state.market[buyGood]]);fail(availableFunds(actor)<price,"insufficient_funds","资产不足，无法购买股票。",409);ensureCash(actor,price);actor.cash-=price;actor.shares.push(makeShare(state,buyGood));state.stock[buyGood]-=1;}
  state.ships=selected.map((good,index)=>({shipId:`ship_${state.voyage}_${index}`,good,position:starts[index],arrived:false,destination:null,workers:[],die:null,plunderedBy:[]}));state.phase="placing";state.placementRound=1;state.placeTurn=state.players.findIndex((player)=>player.id===state.harborMasterId);setDeadline(state,now);addLog(state,`港务长装载了${selected.map((good)=>GOODS[good].name).join("、")}。`,now);present(state,"ships-configured",`${actor.name}完成三艘货船的装载`,now,{priority:3,actorId:actor.id,goods:selected,starts});
}
function placementOptions(state){
  const options=[];state.ships.forEach((ship,index)=>{if(!ship.arrived&&ship.workers.length<GOODS[ship.good].seats.length)options.push({type:"ship",index,cost:GOODS[ship.good].seats[ship.workers.length]});});
  BETS.forEach((bet,index)=>{if(!state.placements.some((item)=>item.type==="port"&&item.index===index))options.push({type:"port",index,cost:bet.cost});if(!state.placements.some((item)=>item.type==="yard"&&item.index===index))options.push({type:"yard",index,cost:bet.cost});});
  [0,1].forEach((index)=>{if(!state.placements.some((item)=>item.type==="pirate"&&item.index===index))options.push({type:"pirate",index,cost:5});});
  [{index:0,cost:2},{index:1,cost:5}].forEach((option)=>{if(!state.placements.some((item)=>item.type==="pilot"&&item.index===option.index))options.push({type:"pilot",...option});});
  if(!state.placements.some((item)=>item.type==="insurance"))options.push({type:"insurance",index:0,cost:-10});return options;
}
function placeName(state,item){if(item.type==="ship")return`${GOODS[state.ships[item.index].good].name}船`;if(item.type==="port")return`港口 ${BETS[item.index].id}`;if(item.type==="yard")return`修船厂 ${BETS[item.index].id}`;return{pirate:"海盗船",pilot:item.index?"大领航员":"小领航员",insurance:"保险公司"}[item.type];}
function placeWorker(state,player,action,now){
  fail(player.assistants<=0,"no_assistants","你已经没有可派遣的助手。",409);const option=placementOptions(state).find((item)=>item.type===action.placeType&&item.index===Number(action.index));fail(!option,"placement_unavailable","该位置已经不能放置。",409);fail(option.type==="insurance"&&availableFunds(player)<=0,"insurance_unavailable","没有资产时不能经营保险公司。",409);
  let cost=option.cost;if(cost>availableFunds(player)){const affordable=placementOptions(state).filter((item)=>item.type!=="insurance").some((item)=>Math.max(0,item.cost)<=availableFunds(player));fail(affordable,"insufficient_funds","资产不足以支付该位置，但仍有更便宜的合法位置。",409);cost=Math.max(0,player.cash);}else if(cost>0)ensureCash(player,cost);
  player.cash-=Math.max(0,cost);if(cost<0)player.cash-=cost;player.assistants-=1;const item={placementId:`placement_${state.voyage}_${state.placements.length+1}`,type:option.type,index:option.index,playerId:player.id,order:state.placements.length};state.placements.push(item);if(item.type==="ship")state.ships[item.index].workers.push(item);addLog(state,`${player.name}派助手前往${placeName(state,item)}。`,now);present(state,"worker-placed",`${player.name}派出一名助手`,now,{actorId:player.id,targetType:item.type,targetIndex:item.index,placementId:item.placementId});advancePlacement(state,now);
}
function advancePlacement(state,now){
  state.placeTurn=(state.placeTurn+1)%state.players.length;
  if(state.placeTurn===state.players.findIndex((player)=>player.id===state.harborMasterId)){if(state.placementRound>=3)return beforeRoll(state,3,now);const round=state.placementRound;state.placementRound+=1;state.placeTurn=state.players.findIndex((player)=>player.id===state.harborMasterId);return prepareDice(state,round,now);}
  setDeadline(state,now);
}
function beforeRoll(state,round,now){if(round===3&&state.placements.some((item)=>item.type==="pilot")){state.phase="pilot";state.pending={pilotIndex:0};return startNextPilot(state,now);}prepareDice(state,round,now);}
function startNextPilot(state,now){const pilots=state.placements.filter((item)=>item.type==="pilot").sort((a,b)=>a.index-b.index),pilot=pilots[state.pending.pilotIndex];if(!pilot)return prepareDice(state,3,now);state.pending.playerId=pilot.playerId;setDeadline(state,now);}
function moveShip(state,ship,delta,now,{pilot=false}={}){if(ship.arrived)return;ship.position+=delta;if(ship.position>13){ship.arrived=true;ship.destination="port";state.port.push(ship.good);addLog(state,`${GOODS[ship.good].name}船${pilot?"由领航员送入":"驶入"}港口 ${String.fromCharCode(64+state.port.length)}。`,now);}}
function pilotMove(state,action,now){
  const pilots=state.placements.filter((item)=>item.type==="pilot").sort((a,b)=>a.index-b.index),pilot=pilots[state.pending.pilotIndex],moves=action.skip?[]:(action.moves||[]);const allowance=pilot.index===0?1:2;fail(moves.length>allowance,"too_many_moves","领航员移动次数超过限制。",409);const projected=new Map();for(const move of moves){const index=Number(move.ship),ship=state.ships[index],delta=Number(move.delta),position=projected.has(index)?projected.get(index):ship?.position;fail(!ship||ship.arrived||Math.abs(delta)!==1||position+delta<0,"invalid_pilot_move","领航员移动无效。",409);projected.set(index,position+delta);}
  moves.forEach((move)=>moveShip(state,state.ships[Number(move.ship)],Number(move.delta),now,{pilot:true}));present(state,"pilot-move",moves.length?`${nameOf(state,pilot.playerId)}调整了货船航程`:`${nameOf(state,pilot.playerId)}放弃领航`,now,{actorId:pilot.playerId,moves:clone(moves)});state.pending.pilotIndex+=1;startNextPilot(state,now);
}
function prepareDice(state,round,now){
  const shipIds=state.ships.map((ship,index)=>ship.arrived?-1:index).filter((index)=>index>=0);if(!shipIds.length)return resolveFinal(state,now);state.phase="rolling";state.rollStage="ready";state.rollRound=round;state.rollId=(state.rollId||0)+1;state.rollStartedAt=0;state.stopRequestedAt=0;state.settleAt=0;state.diceAnimationSeed=nextRandomSeed(Math.random);state.rollingShipIds=shipIds;state.pending={round,arrivals:[],rollValues:[]};setDeadline(state,now);addLog(state,`第 ${round} 轮货物骰已经摆上航海桌。`,now);present(state,"dice-ready",`第 ${round} 轮货物骰就位`,now,{priority:2,actorId:state.harborMasterId,round,shipIds});
}
function startDice(state,now,random){state.rollStage="spinning";state.rollStartedAt=now;state.diceAnimationSeed=nextRandomSeed(random);setDeadline(state,now);addLog(state,`${nameOf(state,state.harborMasterId)}开始摇动货物骰。`,now);present(state,"dice-start",`${nameOf(state,state.harborMasterId)}开始摇骰`,now,{priority:3,actorId:state.harborMasterId,rollId:state.rollId});}
function stopDice(state,now,random){state.pending.rollValues=state.rollingShipIds.map((index)=>rollForGood(state.ships[index].good,random));state.rollStage="slowing";state.stopRequestedAt=now;state.settleAt=now+DICE_SLOWING_MS;setDeadline(state,now,DICE_SLOWING_MS);addLog(state,`${nameOf(state,state.harborMasterId)}喊停，骰点正在减速。`,now);present(state,"dice-stop",`${nameOf(state,state.harborMasterId)}喊停货物骰`,now,{priority:3,actorId:state.harborMasterId,rollId:state.rollId});}
function revealDice(state,now){state.rollingShipIds.forEach((shipIndex,index)=>{state.ships[shipIndex].die=state.pending.rollValues[index];});state.rollStage="settled";state.settleAt=0;setDeadline(state,now,DICE_SETTLED_MS);const text=state.rollingShipIds.map((index)=>`${GOODS[state.ships[index].good].name}${state.ships[index].die}`).join("、");addLog(state,`第 ${state.pending.round} 轮骰点：${text}。`,now);present(state,"dice-result",`骰点定格：${text}`,now,{priority:4,actorId:state.harborMasterId,rollId:state.rollId,values:[...state.pending.rollValues]});}
function finishShipRoll(state,now){const arrivals=state.rollingShipIds.filter((index)=>state.ships[index].position+state.ships[index].die>13);state.pending.arrivals=arrivals;if(arrivals.length>1){state.phase="arrivalOrder";setDeadline(state,now);return;}arrivals.forEach((index)=>moveShip(state,state.ships[index],state.ships[index].die,now));finishRoll(state,now);}
function resolveArrivalOrder(state,order,now){const values=(order||[]).map(Number);fail(values.length!==state.pending.arrivals.length||new Set(values).size!==values.length||values.some((index)=>!state.pending.arrivals.includes(index)),"invalid_arrival_order","进港顺序无效。",409);values.forEach((index)=>moveShip(state,state.ships[index],state.ships[index].die,now));finishRoll(state,now);}
function finishRoll(state,now){
  clearDeadline(state);state.ships.forEach((ship,index)=>{if(!ship.arrived&&!state.pending.arrivals.includes(index))moveShip(state,ship,ship.die,now);});const round=state.pending.round;
  if(round===2){const targets=state.ships.map((ship,index)=>({ship,index})).filter(({ship})=>!ship.arrived&&ship.position===13).map(({index})=>index),pirates=state.placements.filter((item)=>item.type==="pirate");if(targets.length&&pirates.length){state.phase="pirateBoard";state.pending={targets,pirates:clone(pirates),pirateIndex:0,round};setDeadline(state,now);return;}}
  if(round<3){state.phase="placing";setDeadline(state,now);return;}resolveFinal(state,now);
}
function pirateBoard(state,action,now){
  const pirate=state.pending.pirates[state.pending.pirateIndex];if(!action.skip){const shipIndex=Number(action.ship),ship=state.ships[shipIndex];fail(!state.pending.targets.includes(shipIndex)||!ship,"invalid_pirate_target","海盗不能登上该船。",409);let removed=null;if(ship.workers.length>=GOODS[ship.good].seats.length){const index=ship.workers.findLastIndex((worker)=>!worker.boardedPirate);fail(index<0,"pirate_ship_full","船上已经全是海盗。",409);removed=ship.workers.splice(index,1)[0];}if(removed){const player=byId(state,removed.playerId);player.assistants+=1;state.placements=state.placements.filter((item)=>item.placementId!==removed.placementId);addLog(state,`${player.name}最后一名普通助手被海盗踢下船。`,now);}state.placements=state.placements.filter((item)=>item.placementId!==pirate.placementId);const boarded={...pirate,type:"ship",index:shipIndex,boardedPirate:true};ship.workers.push(boarded);addLog(state,`${nameOf(state,pirate.playerId)}的海盗登上${GOODS[ship.good].name}船。`,now);present(state,"pirate-board",`${nameOf(state,pirate.playerId)}登上${GOODS[ship.good].name}船`,now,{priority:4,actorId:pirate.playerId,shipIndex});}
  state.pending.pirateIndex+=1;if(state.pending.pirateIndex>=state.pending.pirates.length){state.phase="placing";setDeadline(state,now);return;}setDeadline(state,now);
}
function resolveFinal(state,now){
  const targets=state.ships.map((ship,index)=>({ship,index})).filter(({ship})=>!ship.arrived&&ship.position===13).map(({index})=>index),piratesByShip={};
  for(const index of targets){const pirates=state.ships[index].workers.filter((worker)=>worker.boardedPirate).sort((a,b)=>a.index-b.index);if(pirates.length)piratesByShip[index]=clone(pirates);}
  const plunderShips=targets.filter((index)=>piratesByShip[index]?.length);if(plunderShips.length){state.phase="plunder";state.pending={ships:plunderShips,piratesByShip,choiceIndex:0};setDeadline(state,now);}
  for(const index of targets.filter((value)=>!plunderShips.includes(value))){const ship=state.ships[index];ship.arrived=true;ship.destination="port";state.port.push(ship.good);addLog(state,`${GOODS[ship.good].name}船停在13格且没有海盗，视为成功进港。`,now);}
  if(plunderShips.length)return;prepareYard(state,now);
}
function plunderChoice(state,action,now){const shipIndex=state.pending.ships[state.pending.choiceIndex],ship=state.ships[shipIndex],pirates=state.pending.piratesByShip[shipIndex]||[],destination=action.destination==="yard"?"yard":"port";ship.workers.forEach((worker)=>{const player=byId(state,worker.playerId);if(player)player.assistants+=1;state.placements=state.placements.filter((item)=>item.placementId!==worker.placementId);});ship.workers=[];ship.plunderedBy=pirates.map((pirate)=>pirate.playerId);ship.arrived=true;ship.destination=destination;if(destination==="port")state.port.push(ship.good);addLog(state,`${GOODS[ship.good].name}船被劫掠并送往${destination==="port"?"港口":"修船厂"}。`,now);present(state,"plunder",`${GOODS[ship.good].name}船被海盗劫掠`,now,{priority:5,actorId:pirates[0]?.playerId||null,targetType:destination,shipIndex});state.pending.choiceIndex+=1;if(state.pending.choiceIndex<state.pending.ships.length){setDeadline(state,now);return;}prepareYard(state,now);}
function prepareYard(state,now){const failures=state.ships.map((ship,index)=>({ship,index})).filter(({ship})=>!ship.arrived).map(({index})=>index);if(failures.length>1){state.phase="yardOrder";state.pending={failures};setDeadline(state,now);return;}finishDestinations(state,failures,now);}
function finishDestinations(state,order,now){const failures=state.pending?.failures||state.ships.map((ship,index)=>!ship.arrived?index:-1).filter((index)=>index>=0),values=(order||[]).map(Number);fail(values.length!==failures.length||new Set(values).size!==values.length||values.some((index)=>!failures.includes(index)),"invalid_yard_order","修船厂顺序无效。",409);for(const index of values){const ship=state.ships[index];ship.arrived=true;ship.destination="yard";state.yard.push(ship.good);}state.ships.filter((ship)=>ship.destination==="yard"&&!state.yard.includes(ship.good)).forEach((ship)=>state.yard.push(ship.good));settle(state,now);}
function payInsurance(state,amount,toId){const agent=state.placements.find((item)=>item.type==="insurance"),payer=agent&&byId(state,agent.playerId);if(!payer){if(toId)byId(state,toId).cash+=amount;return;}const paid=Math.min(amount,availableFunds(payer));ensureCash(payer,paid);payer.cash-=paid;if(toId)byId(state,toId).cash+=amount;}
function netWorth(state,player){return player.cash+player.shares.reduce((sum,share)=>sum+MARKET_VALUES[state.market[share.good]]-(share.mortgaged?15:0),0);}
function settle(state,now){
  clearDeadline(state);state.phase="settling";for(const ship of state.ships){if(ship.plunderedBy.length){const each=Math.floor(GOODS[ship.good].payout/ship.plunderedBy.length);ship.plunderedBy.forEach((id)=>{const player=byId(state,id);if(player)player.cash+=each;});}else if(ship.destination==="port"&&ship.workers.length){const each=GOODS[ship.good].payout/ship.workers.length;ship.workers.forEach((worker)=>{const player=byId(state,worker.playerId);if(player)player.cash+=each;});}}
  for(const type of ["port","yard"]){const destinations=type==="port"?state.port:state.yard;BETS.forEach((bet,index)=>{if(!destinations[index])return;const placement=state.placements.find((item)=>item.type===type&&item.index===index);if(type==="port"){if(placement)byId(state,placement.playerId).cash+=bet.payout;}else payInsurance(state,bet.payout,placement?.playerId);});}
  state.port.forEach((good)=>{state.market[good]=Math.min(4,state.market[good]+1);});state.players.forEach((player)=>{player.assistants=3;});addLog(state,`第 ${state.voyage} 次航行结算完成。`,now);present(state,"voyage-settled",`第 ${state.voyage} 次航行结算完成`,now,{priority:4,voyage:state.voyage});
  if(Object.values(state.market).some((value)=>value===4)){state.phase="ended";state.deadline=0;const best=Math.max(...state.players.map((player)=>netWorth(state,player)));state.winnerIds=state.players.filter((player)=>netWorth(state,player)===best).map((player)=>player.id);state.result={winnerIds:[...state.winnerIds],netWorth:Object.fromEntries(state.players.map((player)=>[player.id,netWorth(state,player)]))};addLog(state,`${state.winnerIds.map((id)=>nameOf(state,id)).join("、")}赢得马尼拉贸易竞赛。`,now);present(state,"game-result",`${state.winnerIds.map((id)=>nameOf(state,id)).join("、")}赢得游戏`,now,{priority:5,winnerIds:[...state.winnerIds]});return;}
  startAuction(state,now,Math.random);
}

export function getSubmissionGroup(state, actorId, action) {
  return ["mortgage", "redeem"].includes(action?.type) && typeof action.shareId === "string" ? "shares" : null;
}

function shareForAction(actor, action) {
  if (action.shareId != null) return actor.shares.find(share => share.shareId === String(action.shareId));
  return actor.shares.find(share => share.mortgaged === (action.type === "redeem"));
}

export function applyAction(state,actorId,action,{now=Date.now(),random=Math.random}={}){
  const actor=requirePlayer(state,actorId);fail(!action||typeof action.type!=="string","invalid_action","操作无效。");
  switch(action.type){
    case"setCapacity":{requireHost(state,actorId);fail(state.phase!=="lobby","wrong_phase","只能在准备阶段修改人数。",409);const capacity=checkedCapacity(action.capacity);fail(capacity<state.players.length,"capacity_too_small","人数不能少于当前玩家数。");state.capacity=capacity;break;}
    case"start":requireHost(state,actorId);fail(state.phase!=="lobby","wrong_phase","游戏已经开始。",409);fail(state.players.length!==state.capacity,"room_not_full",`需要${state.capacity}名玩家才能开始。`,409);dealInitialShares(state,random);state.voyage=0;state.previousMasterId=null;startAuction(state,now,random);break;
    case"end":requireHost(state,actorId);fail(state.phase==="lobby","wrong_phase","当前没有进行中的游戏。",409);resetLobby(state);break;
    case"mortgage":{fail(state.phase==="lobby"||state.phase==="ended","wrong_phase","当前不能抵押股票。",409);mortgageShare(actor,shareForAction(actor,action));break;}
    case"redeem":{fail(state.phase==="lobby"||state.phase==="ended","wrong_phase","当前不能赎回股票。",409);redeemShare(actor,shareForAction(actor,action));break;}
    case"auction":{fail(state.phase!=="auction","wrong_phase","当前不是竞拍阶段。",409);fail(state.players[state.auctionTurn]?.id!==actorId,"not_your_turn","现在没有轮到你出价。",409);if(action.action==="pass"){if(!state.passed.includes(actorId))state.passed.push(actorId);}else{const bid=Number(action.bid);fail(!Number.isInteger(bid)||bid<=state.highBid||bid>availableFunds(actor),"invalid_bid","出价必须高于当前价格且不能超过总资产。",409);state.highBid=bid;state.highBidder=actorId;}nextAuction(state,now);break;}
    case"configure":fail(state.phase!=="configure","wrong_phase","当前不能装载货船。",409);fail(actorId!==state.harborMasterId,"harbor_master_required","只有港务长可以装船。",403);configureShips(state,actor,action,now);break;
    case"place":fail(state.phase!=="placing","wrong_phase","当前不能派遣助手。",409);fail(state.players[state.placeTurn]?.id!==actorId,"not_your_turn","现在没有轮到你放置助手。",409);placeWorker(state,actor,action,now);break;
    case"skipPlacement":fail(state.phase!=="placing","wrong_phase","当前不能跳过放置。",409);fail(state.players[state.placeTurn]?.id!==actorId,"not_your_turn","现在没有轮到你。",409);addLog(state,`${actor.name}跳过了本回合。`,now);advancePlacement(state,now);break;
    case"pilot":fail(state.phase!=="pilot","wrong_phase","当前不能使用领航员。",409);fail(state.pending.playerId!==actorId,"not_your_turn","当前不是你的领航员。",409);pilotMove(state,action,now);break;
    case"startDice":fail(state.phase!=="rolling"||state.rollStage!=="ready","wrong_dice_stage","货物骰尚未等待开始。",409);fail(actorId!==state.harborMasterId,"harbor_master_required","只有港务长可以开始摇骰。",403);startDice(state,now,random);break;
    case"stopDice":fail(state.phase!=="rolling"||state.rollStage!=="spinning","wrong_dice_stage","货物骰当前不能停止。",409);fail(actorId!==state.harborMasterId,"harbor_master_required","只有港务长可以停止骰子。",403);stopDice(state,now,random);break;
    case"order":if(state.phase==="arrivalOrder"){fail(actorId!==state.harborMasterId,"harbor_master_required","只有港务长可以决定进港顺序。",403);resolveArrivalOrder(state,action.order,now);}else if(state.phase==="yardOrder"){fail(actorId!==state.harborMasterId,"harbor_master_required","只有港务长可以决定修船顺序。",403);finishDestinations(state,action.order,now);}else throw new GameRuleError("wrong_phase","当前不需要排序。",409);break;
    case"pirate":fail(state.phase!=="pirateBoard","wrong_phase","当前不能登船。",409);fail(state.pending.pirates[state.pending.pirateIndex]?.playerId!==actorId,"not_your_turn","现在没有轮到你的海盗。",409);pirateBoard(state,action,now);break;
    case"plunder":{fail(state.phase!=="plunder","wrong_phase","当前不能决定劫掠去向。",409);const shipIndex=state.pending.ships[state.pending.choiceIndex],captain=state.pending.piratesByShip[shipIndex]?.[0];fail(captain?.playerId!==actorId,"pirate_captain_required","只有海盗船长可以决定去向。",403);plunderChoice(state,action,now);break;}
    default:throw new GameRuleError("unknown_action","未知操作。");
  }
  validateState(state);
}

export function handleTimeout(state,{now=Date.now(),random=Math.random}={}){
  if(!state.deadline||now<state.deadline)return false;
  if(state.phase==="auction"){const actor=state.players[state.auctionTurn];if(actor&&!state.passed.includes(actor.id))state.passed.push(actor.id);nextAuction(state,now);}
  else if(state.phase==="configure")configureShips(state,byId(state,state.harborMasterId),{goods:shuffle(GOOD_IDS,random).slice(0,3),starts:randomStarts(random),buyGood:null},now);
  else if(state.phase==="placing"){const actor=state.players[state.placeTurn];addLog(state,`${actor.name}放置超时，自动跳过。`,now);advancePlacement(state,now);}
  else if(state.phase==="rolling"&&state.rollStage==="ready")startDice(state,now,random);
  else if(state.phase==="rolling"&&state.rollStage==="spinning")stopDice(state,now,random);
  else if(state.phase==="rolling"&&state.rollStage==="slowing")revealDice(state,now);
  else if(state.phase==="rolling"&&state.rollStage==="settled")finishShipRoll(state,now);
  else if(state.phase==="pilot")pilotMove(state,{skip:true},now);
  else if(state.phase==="arrivalOrder")resolveArrivalOrder(state,[...state.pending.arrivals],now);
  else if(state.phase==="pirateBoard")pirateBoard(state,{skip:true},now);
  else if(state.phase==="plunder")plunderChoice(state,{destination:random()<.5?"port":"yard"},now);
  else if(state.phase==="yardOrder")finishDestinations(state,[...state.pending.failures],now);
  else return false;
  validateState(state);return true;
}
export function getDeadline(state){return Number(state.deadline)||0;}

function viewPlayer(state,player,viewer,ended){
  const own=viewer?.id===player.id;return{id:player.id,name:player.name,isHost:player.isHost,connected:player.connected,color:player.color,cash:own||ended?player.cash:null,assistants:player.assistants,shares:player.shares.map((share)=>own||ended||!share.initial?clone(share):{hidden:true})};
}
function publicView(state,viewer=null){
  const ended=state.phase==="ended",active=activePlayerId(state),pending=state.pending?clone(state.pending):null;if(state.phase==="rolling"&&state.rollStage!=="settled"&&pending)pending.rollValues=[];
  const canPlace=Boolean(viewer&&state.phase==="placing"&&state.players[state.placeTurn]?.id===viewer.id);
  const plunderShip=state.phase==="plunder"?state.pending?.ships?.[state.pending?.choiceIndex||0]:null,plunderCaptain=plunderShip==null?null:state.pending?.piratesByShip?.[plunderShip]?.[0]?.playerId;
  return{stateVersion:state.stateVersion,capacity:state.capacity,phase:state.phase,deadline:state.deadline,voyage:state.voyage,stock:clone(state.stock),market:clone(state.market),harborMasterId:state.harborMasterId,auctionTurn:state.auctionTurn,highBid:state.highBid,highBidder:state.highBidder,passed:[...state.passed],ships:clone(state.ships),placements:clone(state.placements),port:[...state.port],yard:[...state.yard],pending,placementRound:state.placementRound,placeTurn:state.placeTurn,rollStage:state.rollStage,rollStartedAt:state.rollStartedAt,stopRequestedAt:state.stopRequestedAt,settleAt:state.settleAt,diceAnimationSeed:state.diceAnimationSeed,rollId:state.rollId||0,rollingShipIds:[...state.rollingShipIds],winnerIds:[...state.winnerIds],result:ended?clone(state.result):null,players:state.players.map((player)=>viewPlayer(state,player,viewer,ended)),selfId:viewer?.id||null,activePlayerId:active,logs:clone(state.logs),presentationEvents:clone(state.presentationEvents),permissions:{canManage:Boolean(viewer?.isHost),canSetCapacity:Boolean(viewer?.isHost&&state.phase==="lobby"),canStart:Boolean(viewer?.isHost&&state.phase==="lobby"&&state.players.length===state.capacity),canEnd:Boolean(viewer?.isHost&&state.phase!=="lobby"),canMortgage:Boolean(viewer&&!["lobby","ended"].includes(state.phase)&&viewer.shares.some((share)=>!share.mortgaged)),canRedeem:Boolean(viewer&&!["lobby","ended"].includes(state.phase)&&viewer.cash>=15&&viewer.shares.some((share)=>share.mortgaged)),canAuction:Boolean(viewer&&state.phase==="auction"&&active===viewer.id),canConfigure:Boolean(viewer&&state.phase==="configure"&&state.harborMasterId===viewer.id),canPlace,placementOptions:canPlace?placementOptions(state):[],canStartDice:Boolean(viewer&&state.phase==="rolling"&&state.rollStage==="ready"&&state.harborMasterId===viewer.id),canStopDice:Boolean(viewer&&state.phase==="rolling"&&state.rollStage==="spinning"&&state.harborMasterId===viewer.id),canOrder:Boolean(viewer&&["arrivalOrder","yardOrder"].includes(state.phase)&&state.harborMasterId===viewer.id),canPilot:Boolean(viewer&&state.phase==="pilot"&&state.pending?.playerId===viewer.id),canPirate:Boolean(viewer&&state.phase==="pirateBoard"&&state.pending?.pirates?.[state.pending.pirateIndex]?.playerId===viewer.id),canPlunder:Boolean(viewer&&state.phase==="plunder"&&plunderCaptain===viewer.id)}};
}
export function buildView(state,viewerId){return publicView(state,requirePlayer(state,viewerId));}
export function buildSpectatorView(state){return publicView(state,null);}

export function validateState(state){
  fail(!state||state.stateVersion!==STATE_VERSION,"invalid_state_version","房间状态版本不兼容。");fail(!PHASES.has(state.phase),"invalid_phase","房间阶段无效。");checkedCapacity(state.capacity);fail(!Array.isArray(state.players)||state.players.length>state.capacity||new Set(state.players.map((player)=>player.id)).size!==state.players.length,"invalid_players","玩家状态无效。");
  for(const good of GOOD_IDS){fail(!Number.isInteger(state.market[good])||state.market[good]<0||state.market[good]>4,"invalid_market","货价轨道无效。");fail(!Number.isInteger(state.stock[good])||state.stock[good]<0||state.stock[good]>5,"invalid_stock","股票库存无效。");const held=state.players.flatMap((player)=>player.shares).filter((share)=>share.good===good).length;fail(held+state.stock[good]!==5,"share_conservation","股票数量不守恒。");}
  const shares=state.players.flatMap((player)=>player.shares);fail(new Set(shares.map((share)=>share.shareId)).size!==shares.length,"duplicate_share","股票标识重复。");fail(state.players.some((player)=>!Number.isFinite(player.cash)||player.assistants<0||player.assistants>3),"invalid_player_assets","玩家资产无效。");
  if(state.phase!=="lobby"){fail(state.players.length!==state.capacity,"incomplete_started_room","进行中的房间人数不完整。");}
  if(state.phase==="rolling"){fail(!["ready","spinning","slowing","settled"].includes(state.rollStage),"invalid_roll_stage","骰子阶段无效。");fail(!state.pending||!Array.isArray(state.pending.rollValues),"invalid_roll_pending","骰子状态缺失。");}
  try{validatePresentationState(state);}catch{throw new Error("Invalid game7 presentation events");}return true;
}
export function serializeState(state){validateState(state);return clone(state);}
export function restoreState(serialized){fail(serialized?.stateVersion!==STATE_VERSION,"invalid_state_version","无法恢复不兼容的马尼拉房间状态。");const state=clone(serialized);normalizePresentationState(state,{idPrefix:"manila_event",limit:70});state.presentationSceneSequence=Number.isInteger(state.presentationSceneSequence)?state.presentationSceneSequence:0;validateState(state);return state;}
