"use strict";

const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const test = require("node:test");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");

async function post(baseUrl,pathname,body) {
  const response = await fetch(`${baseUrl}${pathname}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  return {response,payload:await response.json()};
}

function openEvents(baseUrl,session) {
  return new Promise((resolve,reject) => {
    const url = new URL("/api/events",baseUrl);
    url.searchParams.set("clientId",session.clientId);
    url.searchParams.set("roomCode",session.roomCode);
    url.searchParams.set("resumeToken",session.resumeToken);
    const request = http.get(url,(response) => {
      if (response.statusCode !== 200) return reject(new Error(`SSE returned ${response.statusCode}`));
      response.once("data",() => resolve({request,response}));
    });
    request.on("error",reject);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => {server.close(resolve);server.closeAllConnections?.();});
}

async function action(baseUrl,session,actionId,value) {
  return post(baseUrl,"/api/actions",{
    roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId,action:value
  });
}

async function viewFor(baseUrl,session) {
  return (await post(baseUrl,"/api/join",{
    roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken
  })).payload.view;
}

async function createReadyRoom(baseUrl) {
  const host = (await post(baseUrl,"/api/rooms",{hostId:"p1",name:"甲",capacity:4})).payload;
  const sessions = [host];
  await openEvents(baseUrl,host);
  for (const [clientId,name] of [["p2","乙"],["p3","丙"],["p4","丁"]]) {
    const joined = (await post(baseUrl,"/api/join",{roomCode:host.roomCode,clientId,name})).payload;
    sessions.push(joined);
    await openEvents(baseUrl,joined);
  }
  for (const [seatIndex,sessionIndex] of [1,0,2,3].entries()) {
    const seated = await action(baseUrl,sessions[sessionIndex],`sit-${sessionIndex}`,{type:"sit",seatIndex});
    assert.equal(seated.response.status,200);
  }
  return sessions;
}

test("game2 server owns turns and sends role-specific secret views",async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startAuthoritativeGameServer({
    gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),
    engine,protocolVersion:3,defaultPort:0
  });
  await new Promise((resolve) => server.once("listening",resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {if (server.listening) await closeServer(server);});

  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode,"server");
  assert.equal(config.protocolVersion,3);
  assert.equal(config.actionSeconds,0);

  const sessions = await createReadyRoom(baseUrl);
  assert.equal((await action(baseUrl,sessions[0],"start",{type:"start"})).response.status,200);
  const views = await Promise.all(sessions.map((session) => viewFor(baseUrl,session)));
  assert.equal(views[0].myRole,"member");
  assert.equal(views[0].idiom,"");
  assert.ok(views[1].idiom);
  assert.equal(views[2].idiom,views[1].idiom);
  assert.equal(views[3].idiom,"");
  assert.equal(views[0].permissions.canManage,true);
  assert.equal(views[0].permissions.canDescribe,false);
  assert.equal(views[1].permissions.canDescribe,true);
  for (const current of views) assert.equal("idiomDeck" in current,false);

  const illegal = await action(baseUrl,sessions[2],"illegal-description",{type:"describe",text:"越权描述"});
  assert.equal(illegal.response.status,409);
  assert.equal(illegal.payload.code,"not_your_turn");
  assert.equal((await action(baseUrl,sessions[1],"description",{type:"describe",text:"和绘画有关"})).response.status,200);
  assert.equal((await action(baseUrl,sessions[0],"correct-guess",{type:"guess",text:views[1].idiom})).response.status,200);
  const scored = await viewFor(baseUrl,sessions[3]);
  assert.deepEqual(scored.scores,[1,0]);
  assert.equal(scored.wordNumber,2);
  assert.equal(scored.turnTeamIndex,1);
});
