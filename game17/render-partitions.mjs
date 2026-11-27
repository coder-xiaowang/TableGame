"use strict";

const PARTITIONS=Object.freeze(["room","status","ticker","information","stockpiles","players","decision","private","log","countdown"]);
const key=(value)=>JSON.stringify(value);

export function createGame17RenderModel(view,{memberRole=view?.roomRole,roomCode=""}={}){
  if(!view)return null;
  const players=Array.isArray(view.players)?view.players:[];
  const permissions=view.permissions||{};
  const self=players.find((player)=>player.id===view.selfId)||null;
  const decisionPermissions={
    canPlaceSupply:permissions.canPlaceSupply,canBid:permissions.canBid,canPlayMarketAction:permissions.canPlayMarketAction,
    canSell:permissions.canSell,canChooseDividend:permissions.canChooseDividend
  };
  const decisionFacts=permissions.canPlaceSupply?[view.supplyBatch,view.supplyHand,(view.stockpiles||[]).map((pile)=>pile.id)]
    :permissions.canBid?[self?.cash,view.bidTokens,(view.stockpiles||[]).map((pile)=>pile.id)]
      :permissions.canPlayMarketAction?[view.marketAction,view.stockPrices]
        :permissions.canSell?[self?.portfolio,self?.splitPortfolio,view.stockPrices]
          :permissions.canChooseDividend?[view.pendingDividend,self?.portfolio,self?.splitPortfolio]:null;
  return{view,memberRole,roomCode,self,keys:{
    room:key([roomCode,view.phase,view.capacity,players.length,
      permissions.canStart||permissions.canRestart?players.map((player)=>[player.id,player.connected]):null,
      permissions.canManage,permissions.canStart,permissions.canRestart,permissions.canEnd,permissions.canSetCapacity]),
    status:key([memberRole,view.phase,view.round,view.totalRounds,view.currentPlayerId,players.length,view.capacity,
      players.map((player)=>[player.id,player.name])]),
    ticker:key([view.round,view.totalRounds,view.deckCount,view.stockPrices,view.closingTape]),
    information:key([view.phase,view.publicInformation,view.revealedInformation,view.hiddenInformationCount,view.finalScores,
      players.map((player)=>[player.id,player.name])]),
    stockpiles:key([view.phase,view.stockpiles,view.bidTokens,players.map((player)=>[player.id,player.name])]),
    players:key([view.selfId,view.phase,view.currentPlayerId,view.firstPlayerId,permissions.canKick,
      players.map((player)=>[player.id,player.name,player.isHost,player.connected,player.cash,player.portfolioCount,player.splitPortfolioCount,player.debts])]),
    decision:key([memberRole,view.phase,view.round,view.currentPlayerId,view.winnerIds,decisionPermissions,decisionFacts,
      players.map((player)=>[player.id,player.name])]),
    private:key([memberRole,view.selfId,self?.cash,self?.privateInformation,self?.portfolio,self?.splitPortfolio,view.holdingSettlement]),
    log:key(view.logs||[]),
    countdown:key([view.phase,view.deadline||0])
  }};
}

export function createGame17PartitionRenderer(renderers={}){
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

export const GAME17_RENDER_PARTITIONS=PARTITIONS;
