"use strict";
const assert=require("node:assert/strict");const http=require("http");const path=require("path");const test=require("node:test");const startServer=require("../shared/server/start-authoritative-game-server");
async function post(base,pathName,body){const response=await fetch(`${base}${pathName}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return{response,payload:await response.json()};}
function events(base,session){return new Promise((resolve,reject)=>{const url=new URL("/api/events",base);url.searchParams.set("clientId",session.clientId);url.searchParams.set("roomCode",session.roomCode);url.searchParams.set("resumeToken",session.resumeToken);const request=http.get(url,(response)=>{if(response.statusCode!==200)return reject(new Error(String(response.statusCode)));response.once("data",()=>resolve({request,response}));});request.on("error",reject);});}
async function close(server){await new Promise((resolve)=>{server.close(resolve);server.closeAllConnections?.();});}
async function action(base,session,id,value){return post(base,"/api/actions",{roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId:id,action:value});}
async function view(base,session){return(await post(base,"/api/join",{roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken})).payload.view;}

test("game13 HTTP server enforces turns and emits player-specific CABO views",async(context)=>{
  const engine=await import("./server/game-engine.mjs");const server=startServer({gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0});await new Promise((resolve)=>server.once("listening",resolve));const base=`http://127.0.0.1:${server.address().port}`;context.after(async()=>{if(server.listening)await close(server);});
  const page=await fetch(base).then((response)=>response.text());assert.match(page,/CABO 联机版/);assert.match(page,/class="table-stage"/);assert.match(page,/class="action-panel table-actions"/);assert.match(page,/class="panel log-panel sidebar-log"/);
  const config=await fetch(`${base}/api/config`).then((response)=>response.json());assert.equal(config.authorityMode,"server");assert.equal(config.actionSeconds,45);
  const host=(await post(base,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;await events(base,host);const guest=(await post(base,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙"})).payload;await events(base,guest);
  assert.equal((await action(base,host,"start",{type:"start"})).response.status,200);
  const h=await view(base,host),g=await view(base,guest);assert.equal(h.deckCount,44);assert.ok(h.players.every((player)=>player.slots.every((slot)=>slot.value===null)));assert.equal(h.players.flatMap((player)=>player.slots).some((slot)=>"card" in slot),false);
  const forged=await action(base,guest,"forge",{type:"drawDeck"});assert.equal(forged.response.status,409);
  await action(base,host,"peek1",{type:"initialPeek",slotIds:h.players[0].slots.slice(0,2).map((slot)=>slot.slotId)});const after=await view(base,host),other=await view(base,guest);assert.equal(after.players[0].slots.filter((slot)=>slot.value!==null).length,2);assert.equal(other.players[0].slots.every((slot)=>slot.value===null),true);
});
