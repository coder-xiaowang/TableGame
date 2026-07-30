"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PROTOCOL_VERSION = 1;
const port = Number(process.env.PORT || 8792);
const root = __dirname;
const rooms = new Map();
const clients = new Map();
const pending = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let value = "";
    request.on("data", (chunk) => {
      value += chunk;
      if (value.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("请求内容过大"));
      }
    });
    request.on("end", () => {
      try {
        resolve(value ? JSON.parse(value) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function createRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < 4; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("无法分配房间号");
}

function push(clientId, event, data) {
  const client = clients.get(clientId);
  if (!client) {
    const queue = pending.get(clientId) || [];
    queue.push({ event, data });
    pending.set(clientId, queue.slice(-80));
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
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    }[path.extname(resolved)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    response.end(data);
  });
}

async function api(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") {
    json(response, 200, { relayMode: true, protocolVersion: PROTOCOL_VERSION });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/events") {
    const clientId = url.searchParams.get("clientId");
    if (!clientId) return json(response, 400, { error: "clientId required" });
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
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
    rooms.set(roomCode, { hostId: data.hostId, createdAt: Date.now() });
    json(response, 200, { roomCode, protocolVersion: PROTOCOL_VERSION });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/join") {
    const data = await readBody(request);
    const roomCode = String(data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return json(response, 404, { error: "room not found" });
    json(response, 200, { roomCode, hostId: room.hostId, protocolVersion: PROTOCOL_VERSION });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/signal") {
    const data = await readBody(request);
    const roomCode = String(data.roomCode || "").toUpperCase();
    if (!rooms.has(roomCode)) return json(response, 404, { error: "room not found" });
    const delivered = push(data.to, "signal", {
      roomCode,
      from: data.from,
      payload: data.payload
    });
    json(response, 200, { delivered, protocolVersion: PROTOCOL_VERSION });
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

server.listen(port, () => {
  console.log(`牛头王联机版：http://localhost:${port}`);
  console.log("联机模式：房主权威状态 + HTTP/SSE 消息中继");
});
