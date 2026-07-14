"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const port = Number(process.env.PORT || 8791);
const root = __dirname;
const protocolVersion = 2;
const rooms = new Map();
const clients = new Map();
const pending = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let value = "";
    request.on("data", (chunk) => {
      value += chunk;
      if (value.length > 1048576) {
        request.destroy();
        reject(new Error("body too large"));
      }
    });
    request.on("end", () => {
      try { resolve(value ? JSON.parse(value) : {}); } catch (error) { reject(error); }
    });
  });
}

function createRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < 4; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("cannot allocate room");
}

function push(clientId, event, data) {
  const client = clients.get(clientId);
  if (!client) {
    const queue = pending.get(clientId) || [];
    queue.push({ event, data });
    pending.set(clientId, queue.slice(-60));
    return false;
  }
  client.response.write(`event: ${event}\n`);
  client.response.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

function serveFile(response, pathname) {
  const target = pathname === "/" ? path.join(root, "index.html") : path.join(root, pathname);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(resolved, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" }[path.extname(resolved)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(data);
  });
}

async function api(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") {
    json(response, 200, { relayMode: true, protocolVersion });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/events") {
    const clientId = url.searchParams.get("clientId");
    if (!clientId) return json(response, 400, { error: "clientId required" });
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    response.write(": connected\n\n");
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    clients.set(clientId, { response, heartbeat });
    (pending.get(clientId) || []).forEach((item) => push(clientId, item.event, item.data));
    pending.delete(clientId);
    request.on("close", () => {
      const client = clients.get(clientId);
      if (client?.response === response) {
        clearInterval(client.heartbeat);
        clients.delete(clientId);
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const data = await readBody(request);
    if (!data.hostId) return json(response, 400, { error: "hostId required" });
    const roomCode = createRoomCode();
    rooms.set(roomCode, { hostId: data.hostId });
    json(response, 200, { roomCode, protocolVersion });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/join") {
    const data = await readBody(request);
    const roomCode = String(data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return json(response, 404, { error: "room not found" });
    if (!data.clientId) return json(response, 400, { error: "clientId required" });
    const delivered = push(room.hostId, "signal", { roomCode, from: data.clientId, payload: { kind: "hello", name: String(data.name || "玩家") } });
    json(response, 200, { roomCode, hostId: room.hostId, delivered, protocolVersion });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/signal") {
    const data = await readBody(request);
    const roomCode = String(data.roomCode || "").toUpperCase();
    if (!rooms.has(roomCode)) return json(response, 404, { error: "room not found" });
    json(response, 200, { delivered: push(data.to, "signal", { roomCode, from: data.from, payload: data.payload }) });
    return;
  }
  json(response, 404, { error: "not found" });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    api(request, response, url).catch((error) => json(response, 500, { error: error.message }));
    return;
  }
  serveFile(response, decodeURIComponent(url.pathname));
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`无法启动 UNO 服务：端口 ${port} 已被其他进程占用。请先关闭旧的 Node 进程。`);
  else console.error("UNO 服务启动失败：", error);
  process.exitCode = 1;
});

server.listen(port, () => {
  console.log(`UNO game: http://localhost:${port}`);
  console.log(`Protocol version: ${protocolVersion}`);
  console.log("Network mode: host-authoritative HTTP + SSE relay");
});
