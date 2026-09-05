"use strict";

import { createId, cleanPlayerName, isValidRoomCode, normalizeRoomCode } from "./utils.js";
import { assertProtocolVersion, MESSAGE_KINDS, readServerConfig, requestJson } from "./protocol.js";
import { createSseChannel } from "./sse-channel.js";

export function createAuthoritativeRoomClient({
  protocolVersion,
  sessionStore,
  fetchImpl = globalThis.fetch,
  EventSourceImpl = globalThis.EventSource,
  onStatus = () => {},
  handlers = {}
} = {}) {
  let role = null;
  let memberRole = null;
  let roomCode = "";
  let playerId = "";
  let hostId = "";
  let resumeToken = "";
  let playerName = "";
  let version = 0;
  let assignmentReason = null;
  let autoSpectated = false;

  function acceptView(view, nextVersion = 0) {
    const numericVersion = Number(nextVersion) || 0;
    if (numericVersion && numericVersion < version) return;
    version = Math.max(version, numericVersion);
    if (view?.roomRole === "player" || view?.roomRole === "spectator") {
      memberRole = view.roomRole;
      if (roomCode && playerId && resumeToken) {
        sessionStore?.save(roomCode, { playerId, resumeToken, name: playerName, memberRole });
      }
    }
    handlers.onView?.(view, version);
  }

  const channel = createSseChannel({
    EventSourceImpl,
    onStatus,
    onMessage(message) {
      const payload = message?.payload;
      if (payload?.kind === MESSAGE_KINDS.VIEW) {
        acceptView(payload.view, payload.version);
      } else if (payload?.kind === MESSAGE_KINDS.KICKED) {
        sessionStore?.clear(roomCode);
        channel.close();
        handlers.onKicked?.();
      } else if (payload?.kind === MESSAGE_KINDS.ROOM_EXPIRED) {
        sessionStore?.clear(roomCode);
        channel.close();
        handlers.onRoomExpired?.();
      } else {
        handlers.onUnknownMessage?.(payload, message);
      }
    }
  });

  const checked = (promise) => promise.then((result) => assertProtocolVersion(result, protocolVersion));
  const post = (path, data) => checked(requestJson(path, data, { fetchImpl }));

  function eventsUrl() {
    const params = new URLSearchParams({ clientId: playerId, roomCode, resumeToken });
    return `/api/events?${params}`;
  }

  async function checkServer() {
    onStatus("checking");
    try {
      const result = assertProtocolVersion(await readServerConfig({ fetchImpl }), protocolVersion);
      if (result.authorityMode !== "server") throw new Error("当前服务端不是权威游戏模式");
      onStatus("idle");
      return result;
    } catch (error) {
      onStatus("error", error);
      throw error;
    }
  }

  async function createRoom({ name, capacity, id = createId("host") } = {}) {
    role = "host";
    playerId = id;
    hostId = id;
    playerName = cleanPlayerName(name, "房主");
    const result = await post("/api/rooms", {
      hostId: playerId,
      name: playerName,
      capacity
    });
    roomCode = result.roomCode;
    resumeToken = result.resumeToken;
    memberRole = result.memberRole || "player";
    assignmentReason = null;
    autoSpectated = false;
    version = Number(result.version) || 0;
    sessionStore?.save(roomCode, { playerId, resumeToken, name: playerName, memberRole });
    acceptView(result.view, result.version);
    await channel.open(eventsUrl());
    return snapshot();
  }

  async function joinRoom({ code, name, id, intent = "play" } = {}) {
    const normalizedCode = normalizeRoomCode(code);
    if (!isValidRoomCode(normalizedCode)) throw new TypeError("请输入四位房间号");
    roomCode = normalizedCode;
    const saved = sessionStore?.load(roomCode);
    playerId = saved?.playerId || id || createId("guest");
    playerName = saved?.name || cleanPlayerName(name, "玩家");
    const result = await post("/api/join", {
      roomCode,
      clientId: playerId,
      resumeToken: saved?.resumeToken,
      name: saved ? "" : playerName,
      intent
    });
    playerId = result.clientId;
    hostId = result.hostId;
    resumeToken = result.resumeToken;
    role = result.role;
    memberRole = result.memberRole || "player";
    assignmentReason = result.assignmentReason || null;
    autoSpectated = Boolean(result.autoSpectated);
    version = Number(result.version) || 0;
    sessionStore?.save(roomCode, { playerId, resumeToken, name: playerName, memberRole });
    acceptView(result.view, result.version);
    await channel.open(eventsUrl());
    return { ...snapshot(), resumed: Boolean(result.resumed) };
  }

  function createActionId() {
    return globalThis.crypto?.randomUUID?.() || createId("action");
  }

  function submitAction(action, { expectedVersion = version } = {}) {
    if (!roomCode || !playerId || !resumeToken) throw new Error("尚未建立房间会话");
    return post("/api/actions", {
      roomCode,
      playerId,
      resumeToken,
      actionId: createActionId(),
      expectedVersion,
      action
    });
  }

  function kick(targetPlayerId) {
    if (role !== "host") throw new Error("只有房主可以移出玩家");
    return post("/api/kick", {
      roomCode,
      hostId: playerId,
      resumeToken,
      playerId: targetPlayerId
    });
  }

  async function changeSeat(intent) {
    if (!roomCode || !playerId || !resumeToken) throw new Error("尚未建立房间会话");
    const result = await post("/api/seat", {
      roomCode,
      playerId,
      resumeToken,
      intent
    });
    memberRole = result.memberRole || memberRole;
    assignmentReason = null;
    autoSpectated = false;
    version = Math.max(version, Number(result.version) || 0);
    sessionStore?.save(roomCode, { playerId, resumeToken, name: playerName, memberRole });
    if (result.view) acceptView(result.view, result.version);
    return snapshot();
  }

  function setRoomSettings({ allowSpectators } = {}) {
    if (role !== "host") throw new Error("只有房主可以修改房间设置");
    return post("/api/room-settings", {
      roomCode,
      hostId: playerId,
      resumeToken,
      allowSpectators
    });
  }

  function snapshot() {
    return Object.freeze({
      role, memberRole, roomCode, playerId, hostId, resumeToken, name: playerName, version,
      assignmentReason, autoSpectated
    });
  }

  function close() { channel.close(); }

  return Object.freeze({
    checkServer, createRoom, joinRoom, submitAction, kick, changeSeat, setRoomSettings, close, snapshot
  });
}
