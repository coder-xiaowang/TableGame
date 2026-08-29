"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createMemoryRoomStore, SCHEMA_VERSION } = require("./memory-room-store");

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

module.exports = function startAuthoritativeGameServer({
  gameRoot,
  engine,
  sharedRoot = path.resolve(__dirname, ".."),
  protocolVersion = 3,
  defaultPort = 8787,
  roomIdleMs = 0.5 * 60 * 60 * 1000,
  roomStore = null
}) {
  if (!engine?.createLobby || !engine?.applyAction || !engine?.buildView) {
    throw new TypeError("an authoritative game engine is required");
  }

  const port = Number(process.env.PORT || defaultPort);
  const resolvedGameRoot = path.resolve(gameRoot);
  const resolvedSharedRoot = path.resolve(sharedRoot);
  const store = roomStore || createMemoryRoomStore();
  if (!store.loadRooms || !store.saveRoom || !store.deleteRoom) {
    throw new TypeError("roomStore must implement loadRooms, saveRoom and deleteRoom");
  }
  const rooms = new Map();
  const clients = new Map();
  let shuttingDown = false;

  function snapshotRoom(room) {
    const serializedState = engine.serializeState
      ? engine.serializeState(room.state)
      : room.state;
    const state = structuredClone(serializedState);
    for (const player of state.players || []) player.connected = false;
    return {
      schemaVersion: Number(store.schemaVersion) || SCHEMA_VERSION,
      protocolVersion,
      hostId: room.hostId,
      members: [...room.members.entries()].map(([id, member]) => ({
        id,
        ...structuredClone(member),
        connected: false
      })),
      state,
      version: room.version,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt
    };
  }

  function persistRoom(roomCode, room) {
    store.saveRoom(roomCode, snapshotRoom(room));
  }

  function restoreRoom(roomCode, snapshot) {
    if (!snapshot || snapshot.schemaVersion !== (Number(store.schemaVersion) || SCHEMA_VERSION)) {
      throw new Error(`Room ${roomCode} uses an unsupported persistence schema`);
    }
    if (snapshot.protocolVersion !== protocolVersion) {
      throw new Error(`Room ${roomCode} uses protocol ${snapshot.protocolVersion}; expected ${protocolVersion}`);
    }
    if (!snapshot.state || !Array.isArray(snapshot.state.players) || !Array.isArray(snapshot.members)) {
      throw new Error(`Room ${roomCode} has an invalid persisted snapshot`);
    }
    const serializedState = structuredClone(snapshot.state);
    const state = engine.restoreState
      ? engine.restoreState(serializedState)
      : serializedState;
    if (!state || !Array.isArray(state.players)) {
      throw new Error(`Room ${roomCode} could not restore its game state`);
    }
    for (const player of state.players) player.connected = false;
    const members = new Map(snapshot.members.map(({ id, ...member }) => [String(id), {
      ...member,
      connected: false,
      actionIds: Array.isArray(member.actionIds) ? member.actionIds.slice(-100) : []
    }]));
    if (!members.has(String(snapshot.hostId))) {
      throw new Error(`Room ${roomCode} is missing its host session`);
    }
    return {
      hostId: String(snapshot.hostId),
      members,
      state,
      version: Number(snapshot.version) || 1,
      timer: null,
      createdAt: Number(snapshot.createdAt) || Date.now(),
      updatedAt: Number(snapshot.updatedAt) || Date.now()
    };
  }

  function sendJson(response, status, payload) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(payload));
  }

  function sendError(response, error) {
    const status = Number(error?.status) || 500;
    sendJson(response, status, {
      error: error?.message || "服务器内部错误",
      code: error?.code || "internal_error",
      protocolVersion
    });
  }

  function readBody(request) {
    return new Promise((resolve, reject) => {
      let text = "";
      request.on("data", (chunk) => {
        text += chunk;
        if (text.length > 1024 * 1024) {
          const error = new Error("请求内容过大");
          error.status = 413;
          error.code = "body_too_large";
          reject(error);
          request.destroy();
        }
      });
      request.on("end", () => {
        try { resolve(text ? JSON.parse(text) : {}); }
        catch {
          const error = new Error("请求内容不是有效的 JSON");
          error.status = 400;
          error.code = "invalid_json";
          reject(error);
        }
      });
    });
  }

  function createRoomCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      const bytes = crypto.randomBytes(4);
      for (let index = 0; index < 4; index += 1) {
        code += ROOM_ALPHABET[bytes[index] % ROOM_ALPHABET.length];
      }
      if (!rooms.has(code)) return code;
    }
    throw new Error("cannot allocate room code");
  }

  const createToken = () => crypto.randomBytes(32).toString("base64url");
  const clientKey = (roomCode, playerId) => `${roomCode}:${playerId}`;
  const getMember = (room, playerId) => room?.members.get(String(playerId || ""));

  function authenticate(room, playerId, resumeToken) {
    const member = getMember(room, playerId);
    if (!member || member.kicked || member.resumeToken !== resumeToken) {
      const error = new Error("玩家会话无效，请重新加入房间。");
      error.status = 403;
      error.code = "invalid_session";
      throw error;
    }
    return member;
  }

  function push(roomCode, playerId, payload) {
    const client = clients.get(clientKey(roomCode, playerId));
    if (!client) return false;
    try {
      client.response.write("event: signal\n");
      client.response.write(`data: ${JSON.stringify({ roomCode, from: "server", payload })}\n\n`);
      return true;
    } catch {
      return false;
    }
  }

  function sendView(roomCode, room, playerId) {
    return push(roomCode, playerId, {
      kind: "view",
      version: room.version,
      view: engine.buildView(room.state, playerId)
    });
  }

  function broadcastViews(roomCode, room) {
    for (const player of room.state.players) sendView(roomCode, room, player.id);
  }

  function clearRoomTimer(room) {
    if (room.timer != null) clearTimeout(room.timer);
    room.timer = null;
  }

  function scheduleRoomTimer(roomCode, room) {
    clearRoomTimer(room);
    const deadline = Number(engine.getDeadline?.(room.state)) || 0;
    if (!deadline) return;
    const delay = Math.max(0, Math.min(2_147_483_647, deadline - Date.now() + 25));
    room.timer = setTimeout(() => {
      room.timer = null;
      if (rooms.get(roomCode) !== room) return;
      const remaining = (Number(engine.getDeadline?.(room.state)) || 0) - Date.now();
      if (remaining > 0) return scheduleRoomTimer(roomCode, room);
      try {
        const now = Date.now();
        const nextState = structuredClone(room.state);
        if (!engine.handleTimeout(nextState, { now })) return;
        const candidate = {
          ...room,
          state: nextState,
          version: room.version + 1,
          updatedAt: now
        };
        persistRoom(roomCode, candidate);
        room.state = nextState;
        room.version = candidate.version;
        room.updatedAt = now;
        broadcastViews(roomCode, room);
        scheduleRoomTimer(roomCode, room);
      } catch (error) {
        console.error(`Room ${roomCode} timeout failed:`, error);
        if (rooms.get(roomCode) === room) {
          room.timer = setTimeout(() => scheduleRoomTimer(roomCode, room), 1000);
        }
      }
    }, delay);
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
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, protocolVersion });
    }

    if (request.method === "GET" && url.pathname === "/api/ready") {
      const ready = store.check ? Boolean(store.check()) : true;
      return sendJson(response, ready ? 200 : 503, {
        ready,
        persistence: store.kind || "custom",
        schemaVersion: Number(store.schemaVersion) || SCHEMA_VERSION,
        protocolVersion
      });
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, 200, {
        authorityMode: "server",
        protocolVersion,
        actionSeconds: engine.ACTION_SECONDS,
        persistence: store.kind || "custom",
        durable: Boolean(store.durable),
        schemaVersion: Number(store.schemaVersion) || SCHEMA_VERSION
      });
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      const playerId = String(url.searchParams.get("clientId") || "");
      const roomCode = String(url.searchParams.get("roomCode") || "").toUpperCase();
      const resumeToken = url.searchParams.get("resumeToken") || "";
      const room = rooms.get(roomCode);
      if (!room) {
        const error = new Error("房间不存在或已经失效。");
        error.status = 404;
        error.code = "room_not_found";
        throw error;
      }
      const member = authenticate(room, playerId, resumeToken);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      response.write(": connected\n\n");
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
      const key = clientKey(roomCode, playerId);
      const previous = clients.get(key);
      if (previous) {
        clearInterval(previous.heartbeat);
        previous.response.end();
      }
      clients.set(key, { response, heartbeat });
      const changed = engine.setPresence(room.state, playerId, true, {
        now: Date.now(), announce: member.everConnected
      });
      member.connected = true;
      member.everConnected = true;
      room.updatedAt = Date.now();
      if (changed) {
        room.version += 1;
        try { persistRoom(roomCode, room); }
        catch (error) { console.error(`Room ${roomCode} presence persistence failed:`, error); }
      }
      broadcastViews(roomCode, room);

      request.on("close", () => {
        const active = clients.get(key);
        if (active?.response !== response) return;
        clearInterval(active.heartbeat);
        clients.delete(key);
        member.connected = false;
        if (shuttingDown) return;
        if (engine.setPresence(room.state, playerId, false, { now: Date.now() })) {
          room.version += 1;
          room.updatedAt = Date.now();
          try { persistRoom(roomCode, room); }
          catch (error) { console.error(`Room ${roomCode} presence persistence failed:`, error); }
          broadcastViews(roomCode, room);
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const data = await readBody(request);
      if (!data.hostId) {
        const error = new Error("缺少房主身份。");
        error.status = 400;
        error.code = "host_id_required";
        throw error;
      }
      const roomCode = createRoomCode();
      const hostId = String(data.hostId);
      const resumeToken = createToken();
      const state = engine.createLobby({
        capacity: data.capacity,
        host: { id: hostId, name: data.name, connected: false }
      });
      const room = {
        hostId,
        members: new Map([[hostId, {
          name: state.players[0].name,
          resumeToken,
          connected: false,
          everConnected: false,
          kicked: false,
          actionIds: []
        }]]),
        state,
        version: 1,
        timer: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      persistRoom(roomCode, room);
      rooms.set(roomCode, room);
      return sendJson(response, 200, {
        roomCode,
        hostId,
        clientId: hostId,
        resumeToken,
        role: "host",
        version: room.version,
        view: engine.buildView(state, hostId),
        protocolVersion
      });
    }

    if (request.method === "POST" && url.pathname === "/api/join") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        const error = new Error("房间不存在或已经失效。");
        error.status = 404;
        error.code = "room_not_found";
        throw error;
      }
      if (!data.clientId) {
        const error = new Error("缺少玩家身份。");
        error.status = 400;
        error.code = "client_id_required";
        throw error;
      }
      const playerId = String(data.clientId);
      let member = getMember(room, playerId);
      let resumed = false;
      if (member && data.resumeToken && member.resumeToken === data.resumeToken && !member.kicked) {
        resumed = true;
      } else if (member) {
        const error = new Error(member.kicked ? "你已被移出房间。" : "该玩家身份无法使用。");
        error.status = member.kicked ? 403 : 409;
        error.code = member.kicked ? "kicked" : "identity_unavailable";
        throw error;
      } else {
        const resumeToken = createToken();
        const nextState = structuredClone(room.state);
        const player = engine.addPlayer(nextState, {
          id: playerId,
          name: data.name,
          connected: false
        }, { now: Date.now() });
        const nextMember = {
          name: player.name,
          resumeToken,
          connected: false,
          everConnected: false,
          kicked: false,
          actionIds: []
        };
        const nextMembers = new Map(room.members);
        nextMembers.set(playerId, nextMember);
        const now = Date.now();
        const candidate = {
          ...room,
          members: nextMembers,
          state: nextState,
          version: room.version + 1,
          updatedAt: now
        };
        persistRoom(roomCode, candidate);
        room.state = nextState;
        room.members.set(playerId, nextMember);
        room.version = candidate.version;
        room.updatedAt = now;
        member = nextMember;
        broadcastViews(roomCode, room);
      }
      return sendJson(response, 200, {
        roomCode,
        hostId: room.hostId,
        clientId: playerId,
        resumeToken: member.resumeToken,
        resumed,
        role: playerId === room.hostId ? "host" : "guest",
        version: room.version,
        view: engine.buildView(room.state, playerId),
        protocolVersion
      });
    }

    if (request.method === "POST" && url.pathname === "/api/actions") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        const error = new Error("房间不存在或已经失效。");
        error.status = 404;
        error.code = "room_not_found";
        throw error;
      }
      const playerId = String(data.playerId || "");
      const member = authenticate(room, playerId, data.resumeToken || "");
      const actionId = String(data.actionId || "").slice(0, 100);
      if (!actionId) {
        const error = new Error("缺少操作编号。");
        error.status = 400;
        error.code = "action_id_required";
        throw error;
      }
      if (member.actionIds.includes(actionId)) {
        return sendJson(response, 200, { duplicate: true, version: room.version, protocolVersion });
      }
      if (Number.isInteger(data.expectedVersion) && data.expectedVersion !== room.version) {
        sendView(roomCode, room, playerId);
        const error = new Error("游戏状态已经更新，请根据最新画面重试。");
        error.status = 409;
        error.code = "version_conflict";
        throw error;
      }
      const now = Date.now();
      const nextState = structuredClone(room.state);
      engine.applyAction(nextState, playerId, data.action, { now });
      const nextActionIds = [...member.actionIds, actionId].slice(-100);
      const nextMembers = new Map(room.members);
      nextMembers.set(playerId, { ...member, actionIds: nextActionIds });
      const candidate = {
        ...room,
        members: nextMembers,
        state: nextState,
        version: room.version + 1,
        updatedAt: now
      };
      persistRoom(roomCode, candidate);
      room.state = nextState;
      member.actionIds = nextActionIds;
      room.version = candidate.version;
      room.updatedAt = now;
      scheduleRoomTimer(roomCode, room);
      broadcastViews(roomCode, room);
      return sendJson(response, 200, { ok: true, version: room.version, protocolVersion });
    }

    if (request.method === "POST" && url.pathname === "/api/kick") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        const error = new Error("房间不存在或已经失效。");
        error.status = 404;
        error.code = "room_not_found";
        throw error;
      }
      authenticate(room, data.hostId, data.resumeToken || "");
      if (room.hostId !== data.hostId) {
        const error = new Error("只有房主可以移出玩家。");
        error.status = 403;
        error.code = "host_required";
        throw error;
      }
      const target = getMember(room, data.playerId);
      if (!target || target.kicked) {
        const error = new Error("无法移出该玩家。");
        error.status = 400;
        error.code = "invalid_kick_target";
        throw error;
      }
      const now = Date.now();
      const nextState = structuredClone(room.state);
      engine.removePlayer(nextState, data.hostId, data.playerId, { now });
      const nextMembers = new Map(room.members);
      nextMembers.set(String(data.playerId), { ...target, kicked: true, connected: false });
      const candidate = {
        ...room,
        members: nextMembers,
        state: nextState,
        version: room.version + 1,
        updatedAt: now
      };
      persistRoom(roomCode, candidate);
      room.state = nextState;
      target.kicked = true;
      target.connected = false;
      push(roomCode, data.playerId, { kind: "kicked" });
      room.version = candidate.version;
      room.updatedAt = now;
      broadcastViews(roomCode, room);
      return sendJson(response, 200, { ok: true, version: room.version, protocolVersion });
    }

    return sendJson(response, 404, { error: "not found", code: "not_found", protocolVersion });
  }

  function loadPersistedRooms() {
    const now = Date.now();
    let restored = 0;
    for (const entry of store.loadRooms()) {
      const roomCode = String(entry.roomCode || "").toUpperCase();
      if (!roomCode || rooms.has(roomCode)) {
        throw new Error(`Invalid or duplicate persisted room code: ${entry.roomCode}`);
      }
      const room = restoreRoom(roomCode, entry.snapshot);
      if (now - room.updatedAt >= roomIdleMs) {
        store.deleteRoom(roomCode);
        continue;
      }
      rooms.set(roomCode, room);
      persistRoom(roomCode, room);
      scheduleRoomTimer(roomCode, room);
      restored += 1;
    }
    if (store.durable) console.log(`Restored ${restored} authoritative room(s) from ${store.kind}.`);
  }

  loadPersistedRooms();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      handleApi(request, response, url).catch((error) => sendError(response, error));
    } else {
      serveStatic(response, url.pathname);
    }
  });
  const closeHttpServer = server.close.bind(server);
  server.close = function closeAuthoritativeServer(callback) {
    shuttingDown = true;
    for (const client of clients.values()) {
      clearInterval(client.heartbeat);
      client.response.end();
    }
    return closeHttpServer(callback);
  };

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [roomCode, room] of rooms) {
      const online = [...room.members.values()].some((member) => member.connected && !member.kicked);
      if (online || now - room.updatedAt < roomIdleMs) continue;
      try {
        store.deleteRoom(roomCode);
        clearRoomTimer(room);
        rooms.delete(roomCode);
      } catch (error) {
        console.error(`Room ${roomCode} cleanup persistence failed:`, error);
      }
    }
  }, Math.min(roomIdleMs, 10 * 60 * 1000));
  cleanup.unref?.();

  server.listen(port, () => {
    console.log(`Authoritative table game: http://localhost:${server.address().port}`);
  });
  server.on("close", () => {
    shuttingDown = true;
    clearInterval(cleanup);
    for (const room of rooms.values()) clearRoomTimer(room);
    for (const client of clients.values()) clearInterval(client.heartbeat);
    store.close?.();
  });
  return server;
};
