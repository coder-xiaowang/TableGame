"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const port = Number(process.env.PORT || 8787);
const root = __dirname;
const rooms = new Map();
const clients = new Map();
const pendingSignals = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
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
  throw new Error("cannot allocate room code");
}

function pushEvent(clientId, event, payload) {
  const client = clients.get(clientId);
  if (!client) {
    const queue = pendingSignals.get(clientId) || [];
    queue.push({ event, payload });
    pendingSignals.set(clientId, queue.slice(-20));
    return false;
  }
  client.response.write(`event: ${event}\n`);
  client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

function flushPending(clientId) {
  const queue = pendingSignals.get(clientId) || [];
  queue.forEach((item) => {
    pushEvent(clientId, item.event, item.payload);
  });
  pendingSignals.delete(clientId);
}

function serveStatic(request, response, pathname) {
  const filePath = pathname === "/"
    ? path.join(root, "index.html")
    : path.join(root, pathname);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const ext = path.extname(resolved);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    }[ext] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") {
    sendJson(response, 200, {
      relayMode: true
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    const clientId = url.searchParams.get("clientId");
    if (!clientId) {
      sendJson(response, 400, { error: "clientId required" });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    response.write(": connected\n\n");
    const heartbeat = setInterval(() => {
      response.write(": heartbeat\n\n");
    }, 15000);
    clients.set(clientId, { response, heartbeat });
    flushPending(clientId);
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
    const body = await readBody(request);
    if (!body.hostId) {
      sendJson(response, 400, { error: "hostId required" });
      return;
    }
    const roomCode = createRoomCode();
    rooms.set(roomCode, {
      hostId: body.hostId,
      createdAt: Date.now()
    });
    sendJson(response, 200, { roomCode });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readBody(request);
    const code = String(body.roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendJson(response, 404, { error: "room not found" });
      return;
    }
    sendJson(response, 200, { roomCode: code, hostId: room.hostId });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signal") {
    const body = await readBody(request);
    const code = String(body.roomCode || "").toUpperCase();
    if (!rooms.has(code)) {
      sendJson(response, 404, { error: "room not found" });
      return;
    }
    const delivered = pushEvent(body.to, "signal", {
      roomCode: code,
      from: body.from,
      payload: body.payload
    });
    sendJson(response, 200, { delivered });
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
    return;
  }
  serveStatic(request, response, decodeURIComponent(url.pathname));
});

server.listen(port, () => {
  console.log(`Guess word game: http://localhost:${port}`);
  console.log("Network mode: server relay over HTTP + SSE");
});
