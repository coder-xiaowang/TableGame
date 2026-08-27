"use strict";

const assert=require("node:assert/strict");
const fs=require("fs");
const http=require("http");
const os=require("os");
const path=require("path");
const test=require("node:test");
const startAuthoritativeGameServer=require("../shared/server/start-authoritative-game-server");
const {createSqliteRoomStore}=require("../shared/server/sqlite-room-store");

async function post(baseUrl,pathname,body){const response=await fetch(`${baseUrl}${pathname}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return{response,payload:await response.json()};}
function openEvents(baseUrl,session){return new Promise((resolve,reject)=>{const url=new URL("/api/events",baseUrl);url.searchParams.set("clientId",session.clientId);url.searchParams.set("roomCode",session.roomCode);url.searchParams.set("resumeToken",session.resumeToken);const request=http.get(url,(response)=>{if(response.statusCode!==200)return reject(new Error(`SSE returned ${response.statusCode}`));response.once("data",()=>resolve({request,response}));});request.on("error",reject);});}
async function startServer(engine,filename){const server=startAuthoritativeGameServer({gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0,roomStore:createSqliteRoomStore({filename})});await new Promise((resolve)=>server.once("listening",resolve));return{server,baseUrl:`http://127.0.0.1:${server.address().port}`};}
async function closeServer(server){await new Promise((resolve)=>{server.close(resolve);server.closeAllConnections?.();});}
async function action(baseUrl,session,actionId,value){return post(baseUrl,"/api/actions",{roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId,action:value});}
async function resume(baseUrl,session){return post(baseUrl,"/api/join",{roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken});}

test("game5 restores a private hand, turn deadline and action deduplication from SQLite",async(context)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"tablegame-game5-restart-"));const filename=path.join(directory,"game5.sqlite");
  const engine=await import("./server/game-engine.mjs");let running=null;
  context.after(async()=>{if(running?.server.listening)await closeServer(running.server);fs.rmSync(directory,{recursive:true,force:true});});
  running=await startServer(engine,filename);
  const host=(await post(running.baseUrl,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;await openEvents(running.baseUrl,host);
  const guest=(await post(running.baseUrl,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙"})).payload;await openEvents(running.baseUrl,guest);
  assert.equal((await action(running.baseUrl,host,"persist-start",{type:"start"})).response.status,200);
  const before=(await resume(running.baseUrl,host)).payload.view;
  const expectedHand=before.players[0].hand.map((card)=>card.id);const expectedTop=before.discard[0].id;const expectedDeadline=before.deadline;
  await closeServer(running.server);
  running=await startServer(engine,filename);
  const config=await fetch(`${running.baseUrl}/api/config`).then((response)=>response.json());assert.equal(config.persistence,"sqlite");assert.equal(config.durable,true);
  const hostView=(await resume(running.baseUrl,host)).payload.view;const guestView=(await resume(running.baseUrl,guest)).payload.view;
  assert.deepEqual(hostView.players[0].hand.map((card)=>card.id),expectedHand);assert.equal(hostView.discard[0].id,expectedTop);assert.equal(hostView.deadline,expectedDeadline);
  assert.ok(guestView.players[0].hand.every((item)=>item===null));assert.ok(hostView.players.every((player)=>!player.connected));
  const duplicate=await action(running.baseUrl,host,"persist-start",{type:"end"});assert.equal(duplicate.response.status,200);assert.equal(duplicate.payload.duplicate,true);
});
