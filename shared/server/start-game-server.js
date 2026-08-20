"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

module.exports = function startGameServer({
  gameRoot,
  sharedRoot = path.resolve(__dirname, ".."),
  protocolVersion = 2,
  defaultPort = 8787
}) {
  const port = Number(process.env.PORT || defaultPort);
  const resolvedGameRoot = path.resolve(gameRoot);
  const resolvedSharedRoot = path.resolve(sharedRoot);
  const rooms = new Map();
  const clients = new Map();
  const pendingSignals = new Map();

  function sendJson(response, status, payload) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(payload));
  }

  function readBody(request) {
    return new Promise((resolve, reject) => {
      let text = "";
      request.on("data", (chunk) => {
        text += chunk;
        if (text.length > 1024 * 1024) {
          request.destroy();
          reject(new Error("body too large"));
        }
      });
      request.on("end", () => {
        try { resolve(text ? JSON.parse(text) : {}); }
        catch (error) { reject(error); }
      });
    });
  }

  function createRoomCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let index = 0; index < 4; index += 1) {
        code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
    throw new Error("cannot allocate room code");
  }

  const createToken = () => `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const getMember = (room, playerId) => room?.members.get(playerId);

  function findMembership(playerId) {
    for (const [roomCode, room] of rooms) {
      const member = getMember(room, playerId);
      if (member) return { roomCode, room, member };
    }
    return null;
  }

  function push(playerId, event, data) {
    const client = clients.get(playerId);
    if (!client) {
      const queue = pendingSignals.get(playerId) || [];
      queue.push({ event, data });
      pendingSignals.set(playerId, queue.slice(-20));
      return false;
    }
    client.response.write(`event: ${event}\n`);
    client.response.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  }

  function updatePresence(playerId, connected) {
    const found = findMembership(playerId);
    if (!found || found.member.connected === connected) return;
    found.member.connected = connected;
    if (playerId !== found.room.hostId) {
      push(found.room.hostId, "signal", {
        roomCode: found.roomCode,
        from: "server",
        payload: { kind: "presence", playerId, connected }
      });
    }
  }

  function safeFile(root, relativePath) {
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
  }

  function serveStatic(response, pathname) {
    const sharedRequest = pathname === "/shared" || pathname.startsWith("/shared/");
    const root = sharedRequest ? resolvedSharedRoot : resolvedGameRoot;
    const relative = sharedRequest
      ? pathname.replace(/^\/shared\/?/, "") || "README.md"
      : pathname === "/" ? "index.html" : pathname.slice(1);
    const file = safeFile(root, decodeURIComponent(relative));
    if (!file) return sendJson(response, 403, { error: "forbidden" });
    fs.readFile(file, (error, content) => {
      if (error) return sendJson(response, 404, { error: "not found" });
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(content);
    });
  }

  async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, 200, { relayMode: true, protocolVersion });
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      const playerId = url.searchParams.get("clientId");
      const roomCode = String(url.searchParams.get("roomCode") || "").toUpperCase();
      const resumeToken = url.searchParams.get("resumeToken") || "";
      const room = rooms.get(roomCode);
      const member = getMember(room, playerId);
      if (!playerId || !room || !member || member.kicked || member.resumeToken !== resumeToken) {
        return sendJson(response, 403, { error: "valid room session required" });
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive"
      });
      response.write(": connected\n\n");
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
      clients.set(playerId, { response, heartbeat });
      updatePresence(playerId, true);
      for (const item of pendingSignals.get(playerId) || []) push(playerId, item.event, item.data);
      pendingSignals.delete(playerId);
      request.on("close", () => {
        const active = clients.get(playerId);
        if (active?.response !== response) return;
        clearInterval(active.heartbeat);
        clients.delete(playerId);
        updatePresence(playerId, false);
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const data = await readBody(request);
      if (!data.hostId) return sendJson(response, 400, { error: "hostId required" });
      const roomCode = createRoomCode();
      const resumeToken = createToken();
      rooms.set(roomCode, {
        hostId: String(data.hostId),
        members: new Map([[String(data.hostId), {
          name: String(data.name || "房主"), resumeToken, connected: false, kicked: false
        }]])
      });
      return sendJson(response, 200, { roomCode, resumeToken, protocolVersion });
    }

    if (request.method === "POST" && url.pathname === "/api/join") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) return sendJson(response, 404, { error: "room not found" });
      if (!data.clientId) return sendJson(response, 400, { error: "clientId required" });
      const playerId = String(data.clientId);
      let member = getMember(room, playerId);
      let resumed = false;
      if (member && data.resumeToken && member.resumeToken === data.resumeToken && !member.kicked) {
        resumed = true;
      } else if (member) {
        return sendJson(response, member.kicked ? 403 : 409, { error: "player identity unavailable" });
      } else {
        member = {
          name: String(data.name || "玩家"), resumeToken: createToken(), connected: false, kicked: false
        };
        room.members.set(playerId, member);
      }
      push(room.hostId, "signal", {
        roomCode,
        from: playerId,
        payload: { kind: "hello", playerId, name: member.name, resumed }
      });
      return sendJson(response, 200, {
        roomCode, hostId: room.hostId, clientId: playerId,
        resumeToken: member.resumeToken, resumed, protocolVersion
      });
    }

    if (request.method === "POST" && url.pathname === "/api/signal") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      const member = getMember(room, data.from);
      if (!room) return sendJson(response, 404, { error: "room not found" });
      if (!member || member.kicked || member.resumeToken !== data.resumeToken) {
        return sendJson(response, 403, { error: "invalid player session" });
      }
      return sendJson(response, 200, {
        delivered: push(data.to, "signal", {
          roomCode, from: data.from, payload: data.payload
        }),
        protocolVersion
      });
    }

    if (request.method === "POST" && url.pathname === "/api/kick") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      const host = getMember(room, data.hostId);
      const target = getMember(room, data.playerId);
      if (!room || room.hostId !== data.hostId || !host || host.resumeToken !== data.resumeToken) {
        return sendJson(response, 403, { error: "host session required" });
      }
      if (!target || data.playerId === room.hostId) {
        return sendJson(response, 400, { error: "invalid kick target" });
      }
      target.kicked = true;
      target.connected = false;
      pendingSignals.delete(data.playerId);
      push(data.playerId, "signal", {
        roomCode, from: "server", payload: { kind: "kicked" }
      });
      return sendJson(response, 200, { ok: true, protocolVersion });
    }

    return sendJson(response, 404, { error: "not found" });
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      handleApi(request, response, url).catch((error) => sendJson(response, 500, { error: error.message }));
    } else {
      serveStatic(response, url.pathname);
    }
  });

  server.listen(port, () => console.log(`Table game: http://localhost:${port}`));
  return server;
};
