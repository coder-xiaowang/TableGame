"use strict";

import { createId, cleanPlayerName, isValidRoomCode, normalizeRoomCode } from "./utils.js";
import { assertProtocolVersion, dispatchRoomMessage, MESSAGE_KINDS, readServerConfig, requestJson } from "./protocol.js";
import { createSseChannel } from "./sse-channel.js";

export function createRoomClient({
  protocolVersion,
  sessionStore,
  fetchImpl = globalThis.fetch,
  EventSourceImpl = globalThis.EventSource,
  onStatus = () => {},
  handlers = {}
} = {}) {
  let role = null;
  let roomCode = "";
  let playerId = "";
  let hostId = "";
  let resumeToken = "";
  let playerName = "";

  const channel = createSseChannel({
    EventSourceImpl,
    onStatus,
    onMessage(message) {
      dispatchRoomMessage(message, {
        [MESSAGE_KINDS.HELLO]: (payload, envelope) => role === "host" && handlers.onHello?.(envelope.from, payload),
        [MESSAGE_KINDS.PRESENCE]: (payload) => role === "host" && handlers.onPresence?.(payload.playerId, payload.connected),
        [MESSAGE_KINDS.ACTION]: (payload, envelope) => role === "host" && handlers.onAction?.(envelope.from, payload.action),
        [MESSAGE_KINDS.VIEW]: (payload) => role === "guest" && handlers.onView?.(payload.view),
        [MESSAGE_KINDS.REJECTED]: (payload) => handlers.onRejected?.(payload.message),
        [MESSAGE_KINDS.KICKED]: () => {
          sessionStore?.clear(roomCode);
          channel.close();
          handlers.onKicked?.();
        },
        unknown: (payload, envelope) => handlers.onUnknownMessage?.(payload, envelope)
      });
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
    const result = await post("/api/rooms", { hostId: playerId, name: playerName });
    roomCode = result.roomCode;
    resumeToken = result.resumeToken;
    await channel.open(eventsUrl());
    return { ...snapshot(), capacity };
  }

  async function joinRoom({ code, name, id } = {}) {
    const normalizedCode = normalizeRoomCode(code);
    if (!isValidRoomCode(normalizedCode)) throw new TypeError("请输入四位房间号");
    role = "guest";
    roomCode = normalizedCode;
    const saved = sessionStore?.load(roomCode);
    playerId = saved?.playerId || id || createId("guest");
    playerName = saved?.name || cleanPlayerName(name, "玩家");
    const result = await post("/api/join", {
      roomCode,
      clientId: playerId,
      resumeToken: saved?.resumeToken,
      name: saved ? "" : playerName
    });
    playerId = result.clientId;
    hostId = result.hostId;
    resumeToken = result.resumeToken;
    await channel.open(eventsUrl());
    sessionStore?.save(roomCode, { playerId, resumeToken, name: playerName });
    await send(hostId, { kind: MESSAGE_KINDS.HELLO, name: playerName, resumed: result.resumed });
    return { ...snapshot(), resumed: Boolean(result.resumed) };
  }

  async function send(to, payload) {
    if (!roomCode || !playerId || !resumeToken) throw new Error("尚未建立房间会话");
    return post("/api/signal", { roomCode, from: playerId, resumeToken, to, payload });
  }

  function submitAction(action) {
    if (role === "host") return handlers.onAction?.(playerId, action);
    return send(hostId, { kind: MESSAGE_KINDS.ACTION, action });
  }

  function sendView(targetPlayerId, view) {
    if (role !== "host") throw new Error("只有房主可以发送玩家视图");
    return send(targetPlayerId, { kind: MESSAGE_KINDS.VIEW, view });
  }

  function reject(targetPlayerId, message) {
    if (role !== "host") throw new Error("只有房主可以拒绝玩家");
    return send(targetPlayerId, { kind: MESSAGE_KINDS.REJECTED, message: String(message) });
  }

  function kick(targetPlayerId) {
    if (role !== "host") throw new Error("只有房主可以移出玩家");
    return post("/api/kick", { roomCode, hostId: playerId, resumeToken, playerId: targetPlayerId });
  }

  function snapshot() {
    return Object.freeze({ role, roomCode, playerId, hostId, resumeToken, name: playerName });
  }

  function close() { channel.close(); }

  return Object.freeze({
    checkServer, createRoom, joinRoom, send, submitAction, sendView, reject, kick, close, snapshot
  });
}
