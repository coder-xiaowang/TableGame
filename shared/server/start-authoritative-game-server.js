"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createMemoryRoomStore, SCHEMA_VERSION } = require("./memory-room-store");

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MEMBER_ROLES = Object.freeze({
  PLAYER: "player",
  SPECTATOR: "spectator"
});
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
  spectatorsEnabled = process.env.SPECTATORS_ENABLED === "1",
  spectatorLimit = process.env.SPECTATOR_LIMIT || 10,
  roomStore = null
}) {
  if (!engine?.createLobby || !engine?.applyAction || !engine?.buildView) {
    throw new TypeError("an authoritative game engine is required");
  }

  const port = Number(process.env.PORT || defaultPort);
  const spectatorsSupported = engine.SUPPORTS_SPECTATORS === true
    && typeof engine.buildSpectatorView === "function"
    && typeof engine.canChangeSeats === "function"
    && typeof engine.vacateSeat === "function";
  const spectatorsActive = spectatorsSupported && spectatorsEnabled === true;
  const resolvedSpectatorLimit = Number(spectatorLimit);
  if (!Number.isInteger(resolvedSpectatorLimit) || resolvedSpectatorLimit < 1 || resolvedSpectatorLimit > 100) {
    throw new TypeError("spectatorLimit must be an integer between 1 and 100");
  }
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
    const playerIds = new Set((state.players || []).map((player) => String(player.id)));
    return {
      schemaVersion: Number(store.schemaVersion) || SCHEMA_VERSION,
      protocolVersion,
      hostId: room.hostId,
      members: [...room.members.entries()].map(([id, member]) => ({
        id,
        ...structuredClone(member),
        role: playerIds.has(String(id)) ? MEMBER_ROLES.PLAYER : MEMBER_ROLES.SPECTATOR,
        connected: false
      })),
      state,
      version: room.version,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      lastPlayerActivityAt: room.lastPlayerActivityAt,
      allowSpectators: room.allowSpectators
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
    const playerIds = new Set(state.players.map((player) => String(player.id)));
    const members = new Map(snapshot.members.map(({ id, ...member }) => [String(id), {
      ...member,
      role: playerIds.has(String(id)) ? MEMBER_ROLES.PLAYER : MEMBER_ROLES.SPECTATOR,
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
      updatedAt: Number(snapshot.updatedAt) || Date.now(),
      lastPlayerActivityAt: Number(snapshot.lastPlayerActivityAt)
        || Number(snapshot.updatedAt)
        || Date.now(),
      allowSpectators: snapshot.allowSpectators !== false
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
  const isPlayer = (member) => member?.role === MEMBER_ROLES.PLAYER;
  const isSpectator = (member) => member?.role === MEMBER_ROLES.SPECTATOR;

  function spectatorMembers(room) {
    return [...room.members.entries()]
      .filter(([, member]) => isSpectator(member) && !member.kicked)
      .map(([id, member]) => ({ id, name: member.name, connected: Boolean(member.connected) }));
  }

  function normalizeMemberName(name, fallback = "旁观者") {
    const normalized = String(name || "").trim().replace(/\s+/g, " ").slice(0, 20);
    return normalized || fallback;
  }

  function roomAllowsSpectators(room) {
    return spectatorsActive && room.allowSpectators !== false;
  }

  function assertSpectatorAdmission(room) {
    if (!spectatorsActive) {
      const error = new Error("当前游戏尚未开放旁观功能。");
      error.status = 409;
      error.code = "spectators_unavailable";
      throw error;
    }
    if (!roomAllowsSpectators(room)) {
      const error = new Error("房主已关闭旁观者加入。");
      error.status = 403;
      error.code = "spectators_disabled";
      throw error;
    }
    if (spectatorMembers(room).length >= resolvedSpectatorLimit) {
      const error = new Error("旁观席人数已满。");
      error.status = 409;
      error.code = "spectator_limit_reached";
      throw error;
    }
  }

  function canChangeSeats(room) {
    return spectatorsActive && engine.canChangeSeats(room.state) === true;
  }

  function markPlayerActivity(room, now = Date.now()) {
    room.lastPlayerActivityAt = now;
    room.updatedAt = now;
  }

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

  function closeClient(roomCode, memberId) {
    const key = clientKey(roomCode, memberId);
    const client = clients.get(key);
    if (!client) return;
    clearInterval(client.heartbeat);
    clients.delete(key);
    client.response.end();
  }

  function buildRoomView(room, memberId) {
    const member = getMember(room, memberId);
    if (!member || member.kicked) {
      const error = new Error("成员身份无效。");
      error.status = 403;
      error.code = "invalid_session";
      throw error;
    }
    if (isSpectator(member) && !spectatorsSupported) {
      const error = new Error("当前游戏无法恢复旁观身份。");
      error.status = 409;
      error.code = "spectators_unavailable";
      throw error;
    }
    const baseView = isSpectator(member)
      ? engine.buildSpectatorView(room.state)
      : engine.buildView(room.state, memberId);
    const spectators = spectatorMembers(room);
    return {
      ...baseView,
      roomRole: member.role,
      spectators,
      spectatorCount: spectators.length,
      spectatorLimit: resolvedSpectatorLimit,
      allowSpectators: roomAllowsSpectators(room)
    };
  }

  function sendView(roomCode, room, playerId) {
    if (!clients.has(clientKey(roomCode, playerId))) return false;
    return push(roomCode, playerId, {
      kind: "view",
      version: room.version,
      view: buildRoomView(room, playerId)
    });
  }

  function broadcastViews(roomCode, room) {
    for (const [memberId, member] of room.members) {
      if (!member.kicked) sendView(roomCode, room, memberId);
    }
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
          updatedAt: now,
          lastPlayerActivityAt: now
        };
        persistRoom(roomCode, candidate);
        room.state = nextState;
        room.version = candidate.version;
        markPlayerActivity(room, now);
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
        schemaVersion: Number(store.schemaVersion) || SCHEMA_VERSION,
        spectatorsSupported,
        spectatorsEnabled: spectatorsActive,
        spectatorLimit: resolvedSpectatorLimit
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
      if (isSpectator(member) && !spectatorsSupported) {
        const error = new Error("当前游戏无法恢复旁观身份。");
        error.status = 409;
        error.code = "spectators_unavailable";
        throw error;
      }
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
      const now = Date.now();
      const wasConnected = member.connected;
      const changed = isPlayer(member)
        ? engine.setPresence(room.state, playerId, true, {
          now, announce: member.everConnected
        })
        : false;
      member.connected = true;
      member.everConnected = true;
      room.updatedAt = now;
      if (isPlayer(member)) room.lastPlayerActivityAt = now;
      if (changed || !wasConnected) {
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
        const closingMember = getMember(room, playerId);
        if (!closingMember?.connected) return;
        closingMember.connected = false;
        if (shuttingDown) return;
        const now = Date.now();
        const presenceChanged = isPlayer(closingMember)
          ? engine.setPresence(room.state, playerId, false, { now })
          : false;
        room.updatedAt = now;
        if (isPlayer(closingMember)) room.lastPlayerActivityAt = now;
        if (presenceChanged || isPlayer(closingMember) || isSpectator(closingMember)) {
          room.version += 1;
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
          role: MEMBER_ROLES.PLAYER,
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
        updatedAt: Date.now(),
        lastPlayerActivityAt: Date.now(),
        allowSpectators: true
      };
      persistRoom(roomCode, room);
      rooms.set(roomCode, room);
      return sendJson(response, 200, {
        roomCode,
        hostId,
        clientId: hostId,
        resumeToken,
        role: "host",
        memberRole: MEMBER_ROLES.PLAYER,
        version: room.version,
        view: buildRoomView(room, hostId),
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
      const requestedIntent = data.intent == null ? "play" : String(data.intent);
      if (requestedIntent !== "play" && requestedIntent !== "spectate") {
        const error = new Error("加入身份必须是 play 或 spectate。");
        error.status = 400;
        error.code = "invalid_join_intent";
        throw error;
      }
      let member = getMember(room, playerId);
      let resumed = false;
      let assignmentReason = null;
      if (member && data.resumeToken && member.resumeToken === data.resumeToken && !member.kicked) {
        resumed = true;
      } else if (member) {
        const error = new Error(member.kicked ? "你已被移出房间。" : "该玩家身份无法使用。");
        error.status = member.kicked ? 403 : 409;
        error.code = member.kicked ? "kicked" : "identity_unavailable";
        throw error;
      } else {
        const resumeToken = createToken();
        const now = Date.now();
        const nextState = structuredClone(room.state);
        let player = null;
        let assignedRole = MEMBER_ROLES.PLAYER;
        if (requestedIntent === "spectate") {
          assertSpectatorAdmission(room);
          assignedRole = MEMBER_ROLES.SPECTATOR;
          assignmentReason = "requested_spectator";
        } else if (spectatorsActive && !canChangeSeats(room)) {
          assertSpectatorAdmission(room);
          assignedRole = MEMBER_ROLES.SPECTATOR;
          assignmentReason = "game_in_progress";
        } else {
          try {
            player = engine.addPlayer(nextState, {
              id: playerId,
              name: data.name,
              connected: false
            }, { now });
          } catch (error) {
            if (!spectatorsActive || error?.code !== "room_full") throw error;
            assertSpectatorAdmission(room);
            assignedRole = MEMBER_ROLES.SPECTATOR;
            assignmentReason = "player_seats_full";
          }
        }
        const nextMember = {
          name: player?.name || normalizeMemberName(data.name),
          role: assignedRole,
          resumeToken,
          connected: false,
          everConnected: false,
          kicked: false,
          actionIds: []
        };
        const nextMembers = new Map(room.members);
        nextMembers.set(playerId, nextMember);
        const candidate = {
          ...room,
          members: nextMembers,
          state: nextState,
          version: room.version + 1,
          updatedAt: now,
          lastPlayerActivityAt: assignedRole === MEMBER_ROLES.PLAYER
            ? now
            : room.lastPlayerActivityAt
        };
        persistRoom(roomCode, candidate);
        room.state = nextState;
        room.members = nextMembers;
        room.version = candidate.version;
        room.updatedAt = now;
        room.lastPlayerActivityAt = candidate.lastPlayerActivityAt;
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
        memberRole: member.role,
        requestedIntent,
        assignmentReason,
        autoSpectated: !resumed
          && requestedIntent === "play"
          && isSpectator(member),
        version: room.version,
        view: buildRoomView(room, playerId),
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
      if (isSpectator(member)) {
        const error = new Error("旁观者不能提交游戏操作。");
        error.status = 403;
        error.code = "spectator_cannot_act";
        throw error;
      }
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
        updatedAt: now,
        lastPlayerActivityAt: now
      };
      persistRoom(roomCode, candidate);
      room.state = nextState;
      member.actionIds = nextActionIds;
      room.version = candidate.version;
      markPlayerActivity(room, now);
      scheduleRoomTimer(roomCode, room);
      broadcastViews(roomCode, room);
      return sendJson(response, 200, { ok: true, version: room.version, protocolVersion });
    }

    if (request.method === "POST" && url.pathname === "/api/seat") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        const error = new Error("房间不存在或已经失效。");
        error.status = 404;
        error.code = "room_not_found";
        throw error;
      }
      if (!spectatorsActive) {
        const error = new Error("当前游戏尚未开放旁观功能。");
        error.status = 409;
        error.code = "spectators_unavailable";
        throw error;
      }
      const memberId = String(data.playerId || "");
      const member = authenticate(room, memberId, data.resumeToken || "");
      const intent = String(data.intent || "");
      if (intent !== "play" && intent !== "spectate") {
        const error = new Error("座位意图必须是 play 或 spectate。");
        error.status = 400;
        error.code = "invalid_seat_intent";
        throw error;
      }
      const desiredRole = intent === "play" ? MEMBER_ROLES.PLAYER : MEMBER_ROLES.SPECTATOR;
      if (member.role === desiredRole) {
        return sendJson(response, 200, {
          ok: true,
          unchanged: true,
          memberRole: member.role,
          version: room.version,
          view: buildRoomView(room, memberId),
          protocolVersion
        });
      }
      if (!canChangeSeats(room)) {
        const error = new Error("当前阶段不能切换玩家席和旁观席。");
        error.status = 409;
        error.code = "seat_change_unavailable";
        throw error;
      }
      if (intent === "spectate" && memberId === room.hostId) {
        const error = new Error("房主不能转入旁观席。");
        error.status = 403;
        error.code = "host_must_remain_player";
        throw error;
      }

      const now = Date.now();
      const nextState = structuredClone(room.state);
      if (intent === "spectate") {
        assertSpectatorAdmission(room);
        engine.vacateSeat(nextState, memberId, { now });
      } else {
        engine.addPlayer(nextState, {
          id: memberId,
          name: member.name,
          connected: member.connected
        }, { now });
      }
      const nextMembers = new Map(room.members);
      nextMembers.set(memberId, { ...member, role: desiredRole, actionIds: [] });
      const candidate = {
        ...room,
        state: nextState,
        members: nextMembers,
        version: room.version + 1,
        updatedAt: now,
        lastPlayerActivityAt: now
      };
      persistRoom(roomCode, candidate);
      room.state = nextState;
      room.members = nextMembers;
      room.version = candidate.version;
      markPlayerActivity(room, now);
      broadcastViews(roomCode, room);
      return sendJson(response, 200, {
        ok: true,
        memberRole: desiredRole,
        version: room.version,
        view: buildRoomView(room, memberId),
        protocolVersion
      });
    }

    if (request.method === "POST" && url.pathname === "/api/room-settings") {
      const data = await readBody(request);
      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        const error = new Error("房间不存在或已经失效。");
        error.status = 404;
        error.code = "room_not_found";
        throw error;
      }
      const hostId = String(data.hostId || "");
      authenticate(room, hostId, data.resumeToken || "");
      if (room.hostId !== hostId) {
        const error = new Error("只有房主可以修改旁观设置。");
        error.status = 403;
        error.code = "host_required";
        throw error;
      }
      if (!spectatorsActive) {
        const error = new Error("当前游戏尚未开放旁观功能。");
        error.status = 409;
        error.code = "spectators_unavailable";
        throw error;
      }
      if (typeof data.allowSpectators !== "boolean") {
        const error = new Error("allowSpectators 必须是布尔值。");
        error.status = 400;
        error.code = "invalid_room_settings";
        throw error;
      }
      if (room.allowSpectators === data.allowSpectators) {
        return sendJson(response, 200, {
          ok: true,
          unchanged: true,
          allowSpectators: roomAllowsSpectators(room),
          version: room.version,
          protocolVersion
        });
      }
      const now = Date.now();
      const candidate = {
        ...room,
        allowSpectators: data.allowSpectators,
        version: room.version + 1,
        updatedAt: now,
        lastPlayerActivityAt: now
      };
      persistRoom(roomCode, candidate);
      room.allowSpectators = data.allowSpectators;
      room.version = candidate.version;
      markPlayerActivity(room, now);
      broadcastViews(roomCode, room);
      return sendJson(response, 200, {
        ok: true,
        allowSpectators: roomAllowsSpectators(room),
        version: room.version,
        protocolVersion
      });
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
      const hostId = String(data.hostId || "");
      authenticate(room, hostId, data.resumeToken || "");
      if (room.hostId !== hostId) {
        const error = new Error("只有房主可以移出玩家。");
        error.status = 403;
        error.code = "host_required";
        throw error;
      }
      const target = getMember(room, data.playerId);
      const targetId = String(data.playerId || "");
      if (!target || target.kicked || targetId === room.hostId) {
        const error = new Error("无法移出该玩家。");
        error.status = 400;
        error.code = "invalid_kick_target";
        throw error;
      }
      const now = Date.now();
      const nextState = structuredClone(room.state);
      if (isPlayer(target)) engine.removePlayer(nextState, hostId, targetId, { now });
      const nextMembers = new Map(room.members);
      nextMembers.set(targetId, { ...target, kicked: true, connected: false });
      const candidate = {
        ...room,
        members: nextMembers,
        state: nextState,
        version: room.version + 1,
        updatedAt: now,
        lastPlayerActivityAt: now
      };
      persistRoom(roomCode, candidate);
      room.state = nextState;
      room.members = nextMembers;
      push(roomCode, targetId, { kind: "kicked" });
      closeClient(roomCode, targetId);
      room.version = candidate.version;
      markPlayerActivity(room, now);
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
      if (now - room.lastPlayerActivityAt >= roomIdleMs) {
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
      const playerOnline = [...room.members.values()].some((member) => (
        isPlayer(member) && member.connected && !member.kicked
      ));
      if (playerOnline || now - room.lastPlayerActivityAt < roomIdleMs) continue;
      try {
        for (const [memberId, member] of room.members) {
          if (member.kicked) continue;
          push(roomCode, memberId, { kind: "room_expired" });
          closeClient(roomCode, memberId);
        }
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
