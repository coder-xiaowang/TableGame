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

function createResumeToken() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function getRoomMember(room, clientId) {
  return room?.members.get(clientId);
}

function findRoomByMember(clientId) {
  for (const [roomCode, room] of rooms) {
    const member = room.members.get(clientId);
    if (member) return { roomCode, room, member };
  }
  return null;
}

function notifyHost(roomCode, room, payload) {
  if (room.hostId && payload.playerId !== room.hostId) {
    pushEvent(room.hostId, "signal", { roomCode, from: "server", payload });
  }
}

function updatePresence(clientId, connected) {
  const match = findRoomByMember(clientId);
  if (!match || match.member.connected === connected) return;
  match.member.connected = connected;
  match.member.lastSeenAt = Date.now();
  notifyHost(match.roomCode, match.room, { kind: "presence", playerId: clientId, connected });
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
    const roomCode = String(url.searchParams.get("roomCode") || "").toUpperCase();
    const resumeToken = url.searchParams.get("resumeToken") || "";
    const room = rooms.get(roomCode);
    const member = getRoomMember(room, clientId);
    if (!clientId || !room || !member || member.kicked || member.resumeToken !== resumeToken) {
      sendJson(response, 403, { error: "valid room session required" });
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
    updatePresence(clientId, true);
    flushPending(clientId);
    request.on("close", () => {
      const client = clients.get(clientId);
      if (client?.response === response) {
        clearInterval(client.heartbeat);
        clients.delete(clientId);
        updatePresence(clientId, false);
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
    const resumeToken = createResumeToken();
    rooms.set(roomCode, {
      hostId: body.hostId,
      createdAt: Date.now(),
      members: new Map([[body.hostId, {
        name: String(body.name || "房主"),
        resumeToken,
        connected: false,
        kicked: false,
        lastSeenAt: Date.now()
      }]])
    });
    sendJson(response, 200, { roomCode, resumeToken });
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
    const requestedId = String(body.clientId || "");
    const requestedToken = String(body.resumeToken || "");
    let member = getRoomMember(room, requestedId);
    let resumed = false;
    let clientId = requestedId;
    if (member && requestedToken && member.resumeToken === requestedToken && !member.kicked) {
      resumed = true;
      if (body.name) member.name = String(body.name);
    } else {
      if (!requestedId) {
        sendJson(response, 400, { error: "clientId required" });
        return;
      }
      if (member || room.hostId === requestedId) {
        sendJson(response, 409, { error: "player identity unavailable" });
        return;
      }
      member = {
        name: String(body.name || "玩家"),
        resumeToken: createResumeToken(),
        connected: false,
        kicked: false,
        lastSeenAt: Date.now()
      };
      room.members.set(requestedId, member);
    }
    sendJson(response, 200, { roomCode: code, hostId: room.hostId, clientId, resumeToken: member.resumeToken, resumed });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signal") {
    const body = await readBody(request);
    const code = String(body.roomCode || "").toUpperCase();
    const room = rooms.get(code);
    const member = getRoomMember(room, body.from);
    if (!room) {
      sendJson(response, 404, { error: "room not found" });
      return;
    }
    if (!member || member.kicked || member.resumeToken !== body.resumeToken) {
      sendJson(response, 403, { error: "invalid player session" });
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

  if (request.method === "POST" && url.pathname === "/api/kick") {
    const body = await readBody(request);
    const code = String(body.roomCode || "").toUpperCase();
    const room = rooms.get(code);
    const host = getRoomMember(room, body.hostId);
    const target = getRoomMember(room, body.playerId);
    if (!room || room.hostId !== body.hostId || !host || host.resumeToken !== body.resumeToken) {
      sendJson(response, 403, { error: "host session required" });
      return;
    }
    if (!target || body.playerId === room.hostId) {
      sendJson(response, 400, { error: "invalid kick target" });
      return;
    }
    target.kicked = true;
    target.connected = false;
    pendingSignals.delete(body.playerId);
    pushEvent(body.playerId, "signal", { roomCode: code, from: "server", payload: { kind: "kicked" } });
    sendJson(response, 200, { ok: true });
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
