"use strict";
const assert=require("node:assert/strict");const fs=require("fs");const http=require("http");const os=require("os");const path=require("path");const test=require("node:test");const startServer=require("../shared/server/start-authoritative-game-server");const {createSqliteRoomStore}=require("../shared/server/sqlite-room-store");
async function post(base,pathName,body){const response=await fetch(`${base}${pathName}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return{response,payload:await response.json()};}
function events(base,session){return new Promise((resolve,reject)=>{const url=new URL("/api/events",base);url.searchParams.set("clientId",session.clientId);url.searchParams.set("roomCode",session.roomCode);url.searchParams.set("resumeToken",session.resumeToken);const request=http.get(url,(response)=>{if(response.statusCode!==200)return reject(new Error(String(response.statusCode)));response.once("data",()=>resolve({request,response}));});request.on("error",reject);});}
async function start(engine,filename){const server=startServer({gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0,roomStore:createSqliteRoomStore({filename})});await new Promise((resolve)=>server.once("listening",resolve));return{server,base:`http://127.0.0.1:${server.address().port}`};}
async function close(server){await new Promise((resolve)=>{server.close(resolve);server.closeAllConnections?.();});}
async function action(running,session,id,value){return post(running.base,"/api/actions",{roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId:id,action:value});}
async function resume(running,session){return post(running.base,"/api/join",{roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken});}

test("SQLite restart preserves initial private knowledge and action deduplication",async(context)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-cabo-"));const filename=path.join(directory,"game13.sqlite");const engine=await import("./server/game-engine.mjs");let running=null;
  context.after(async()=>{if(running?.server.listening)await close(running.server);fs.rmSync(directory,{recursive:true,force:true});});
  running=await start(engine,filename);const host=(await post(running.base,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;await events(running.base,host);const guest=(await post(running.base,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙"})).payload;await events(running.base,guest);await action(running,host,"start",{type:"start"});
  const before=(await resume(running,host)).payload.view;const selected=before.players[0].slots.slice(0,2).map((slot)=>slot.slotId);await action(running,host,"private-peek",{type:"initialPeek",slotIds:selected});const privateBefore=(await resume(running,host)).payload.view;const values=privateBefore.players[0].slots.map((slot)=>slot.value);
  await close(running.server);running=await start(engine,filename);
  const hostAfter=(await resume(running,host)).payload.view;const guestAfter=(await resume(running,guest)).payload.view;assert.deepEqual(hostAfter.players[0].slots.map((slot)=>slot.value),values);assert.ok(guestAfter.players[0].slots.every((slot)=>slot.value===null));assert.ok(hostAfter.players.every((player)=>!player.connected));
  const duplicate=await action(running,host,"private-peek",{type:"end"});assert.equal(duplicate.response.status,200);assert.equal(duplicate.payload.duplicate,true);
});
