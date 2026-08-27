"use strict";

const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const test = require("node:test");
const startAuthoritativeGameServer = require("../shared/server/start-authoritative-game-server");

async function post(baseUrl,pathname,body) {
  const response = await fetch(`${baseUrl}${pathname}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return {response,payload:await response.json()};
}
function openEvents(baseUrl,session) {
  return new Promise((resolve,reject) => {
    const url = new URL("/api/events",baseUrl);
    url.searchParams.set("clientId",session.clientId); url.searchParams.set("roomCode",session.roomCode); url.searchParams.set("resumeToken",session.resumeToken);
    const request = http.get(url,(response) => {
      if (response.statusCode !== 200) return reject(new Error(`SSE returned ${response.statusCode}`));
      response.once("data",() => resolve({request,response}));
    });
    request.on("error",reject);
  });
}
async function closeServer(server) { await new Promise((resolve) => {server.close(resolve);server.closeAllConnections?.();}); }
async function action(baseUrl,session,actionId,value) {
  return post(baseUrl,"/api/actions",{roomCode:session.roomCode,playerId:session.clientId,resumeToken:session.resumeToken,actionId,action:value});
}
async function viewFor(baseUrl,session) {
  return (await post(baseUrl,"/api/join",{roomCode:session.roomCode,clientId:session.clientId,resumeToken:session.resumeToken})).payload.view;
}

test("game6 server owns the deck and sends a different secret view to each player",async (context) => {
  const engine = await import("./server/game-engine.mjs");
  const server = startAuthoritativeGameServer({gameRoot:path.resolve(__dirname),sharedRoot:path.resolve(__dirname,"../shared"),engine,protocolVersion:3,defaultPort:0});
  await new Promise((resolve) => server.once("listening",resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {if (server.listening) await closeServer(server);});
  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
  assert.equal(config.authorityMode,"server"); assert.equal(config.protocolVersion,3); assert.equal(config.actionSeconds,15);

  const host = (await post(baseUrl,"/api/rooms",{hostId:"p1",name:"甲",capacity:2})).payload;
  await openEvents(baseUrl,host);
  const guest = (await post(baseUrl,"/api/join",{roomCode:host.roomCode,clientId:"p2",name:"乙"})).payload;
  await openEvents(baseUrl,guest);
  assert.equal((await action(baseUrl,host,"start",{type:"start"})).response.status,200);
  const hostView = await viewFor(baseUrl,host);
  const guestView = await viewFor(baseUrl,guest);
  assert.ok(hostView.players[0].hand.every(Number.isInteger));
  assert.ok(hostView.players[1].hand.every((card) => card === null));
  assert.ok(guestView.players[0].hand.every((card) => card === null));
  assert.equal("playQueue" in hostView,false);

  const card = hostView.players[0].hand[0];
  assert.equal((await action(baseUrl,host,"select-host",{type:"selectCard",card})).response.status,200);
  const hidden = await viewFor(baseUrl,guest);
  assert.equal(hidden.players[0].hasSelected,true);
  assert.equal(hidden.players[0].selectedCard,null);
  assert.deepEqual(hidden.players[0].hand,Array(10).fill(null));
  const forged = await action(baseUrl,guest,"forged",{type:"selectCard",card});
  assert.equal(forged.response.status,409);
  assert.equal(forged.payload.code,"card_not_in_hand");
  const guestCard = guestView.players[1].hand[0];
  assert.equal((await action(baseUrl,guest,"select-guest",{type:"selectCard",card:guestCard})).response.status,200);
  const revealedHost = await viewFor(baseUrl,host);
  const revealedGuest = await viewFor(baseUrl,guest);
  assert.equal(revealedHost.phase,"revealing");
  assert.deepEqual(revealedHost.revealedPlays,revealedGuest.revealedPlays);
  assert.deepEqual(revealedHost.revealedPlays.map((play) => play.card),[card,guestCard].sort((left,right) => left-right));
  assert.ok(revealedHost.revealedPlays.every((play) => play.status === "waiting"));
  assert.equal("playQueue" in revealedHost,false);
});
