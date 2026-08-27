"use strict";

const assert=require("node:assert/strict");
const http=require("http");
const path=require("path");
const test=require("node:test");
const startAuthoritativeGameServer=require("../shared/server/start-authoritative-game-server");

async function post(baseUrl,pathname,body){const response=await fetch(`${baseUrl}${pathname}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return{response,payload:await response.json()};}
function openEvents(baseUrl,session){return new Promise((resolve,reject)=>{const url=new URL("/api/events",baseUrl);url.searchParams.set("clientId",session.clientId);url.searchParams.set("roomCode",session.roomCode);url.searchParams.set("resumeToken",session.resumeToken);const request=http.get(url,(response)=>{if(response.statusCode!==200)return reject(new Error(`SSE returned ${response.statusCode}`));response.once("data",()=>resolve({request,response}));});request.on("error",reject);});}
async function closeServer(server){await new Promise((resolve)=>{server.close(resolve);server.closeAllConnections?.();});}
async function action(baseUrl,session,actionId,value){return post(baseUrl,"/api/actions",{roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId,action:value});}
async function viewFor(baseUrl,session){return(await post(baseUrl,"/api/join",{roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken})).payload.view;}

test("game5 server owns turns, cards and player-specific hidden views",async(context)=>{
  const engine=await import("./server/game-engine.mjs");
  const server=startAuthoritativeGameServer({gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0});
  await new Promise((resolve)=>server.once("listening",resolve));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  context.after(async()=>{if(server.listening)await closeServer(server);});
  const config=await fetch(`${baseUrl}/api/config`).then((response)=>response.json());
  assert.equal(config.authorityMode,"server");assert.equal(config.protocolVersion,3);assert.equal(config.actionSeconds,15);
  const host=(await post(baseUrl,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;await openEvents(baseUrl,host);
  const guest=(await post(baseUrl,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙"})).payload;await openEvents(baseUrl,guest);
  assert.equal((await action(baseUrl,host,"start",{type:"start"})).response.status,200);
  const hostView=await viewFor(baseUrl,host);const guestView=await viewFor(baseUrl,guest);
  assert.equal(hostView.deckCount+hostView.discard.length+hostView.players.reduce((sum,player)=>sum+player.hand.length,0),108);
  assert.ok(hostView.players[0].hand.every(Boolean));assert.ok(hostView.players[1].hand.every((item)=>item===null));
  assert.ok(guestView.players[0].hand.every((item)=>item===null));assert.equal("pendingWild" in hostView,false);
  const outOfTurn=await action(baseUrl,guest,"guest-forge",{type:"draw"});assert.equal(outOfTurn.response.status,409);assert.equal(outOfTurn.payload.code,"not_your_turn");
  if(hostView.playableCardIds.length){
    const card=hostView.players[0].hand.find((item)=>item.id===hostView.playableCardIds[0]);
    const played=await action(baseUrl,host,"host-play",{type:"play",cardId:card.id,...((card.type==="wild"||card.type==="wild4")?{color:"blue"}:{})});
    assert.equal(played.response.status,200);
    const next=await viewFor(baseUrl,guest);assert.equal(next.discard[0].id,card.id);
  }else{
    assert.equal((await action(baseUrl,host,"host-draw",{type:"draw"})).response.status,200);
    const next=await viewFor(baseUrl,host);assert.equal(next.players[0].hand.length>=7,true);
    if(next.drawnCardId)assert.deepEqual(next.playableCardIds,[next.drawnCardId]);
  }
});
