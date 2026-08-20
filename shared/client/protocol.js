"use strict";

export const MESSAGE_KINDS = Object.freeze({
  HELLO: "hello",
  PRESENCE: "presence",
  ACTION: "action",
  VIEW: "view",
  REJECTED: "rejected",
  KICKED: "kicked"
});

export class HttpError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.payload = payload;
  }
}

export class ProtocolVersionError extends Error {
  constructor(expected, actual) {
    super(`联机协议版本不匹配：需要 v${expected}，服务端为 v${actual ?? "unknown"}`);
    this.name = "ProtocolVersionError";
    this.expected = expected;
    this.actual = actual;
  }
}

export function assertProtocolVersion(payload, expectedVersion) {
  if (expectedVersion != null && payload?.protocolVersion !== expectedVersion) {
    throw new ProtocolVersionError(expectedVersion, payload?.protocolVersion);
  }
  return payload;
}

export async function requestJson(path, data, { fetchImpl = globalThis.fetch, signal } = {}) {
  const response = await fetchImpl(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* response may not be JSON */ }
  if (!response.ok) {
    throw new HttpError(payload?.error || `${response.status} ${response.statusText}`, {
      status: response.status,
      payload
    });
  }
  return payload;
}

export async function readServerConfig({ fetchImpl = globalThis.fetch, path = "/api/config" } = {}) {
  const response = await fetchImpl(path, { cache: "no-store" });
  if (!response.ok) throw new HttpError(`无法读取联机配置：${response.status}`, { status: response.status });
  return response.json();
}

export function dispatchRoomMessage(message, handlers = {}) {
  const payload = message?.payload;
  const handler = payload?.kind && handlers[payload.kind];
  if (typeof handler === "function") return handler(payload, message);
  return handlers.unknown?.(payload, message);
}
