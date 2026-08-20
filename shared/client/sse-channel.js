"use strict";

export function createSseChannel({
  EventSourceImpl = globalThis.EventSource,
  connectTimeoutMs = 5000,
  onMessage = () => {},
  onStatus = () => {}
} = {}) {
  let source = null;

  function close() {
    source?.close();
    source = null;
    onStatus("closed");
  }

  function open(url) {
    close();
    onStatus("connecting");
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        source?.close();
        reject(new Error("事件通道连接超时"));
      }, connectTimeoutMs);

      source = new EventSourceImpl(url);
      source.addEventListener("signal", (event) => {
        try { onMessage(JSON.parse(event.data)); }
        catch (error) { onStatus("message-error", error); }
      });
      source.addEventListener("open", () => {
        onStatus("open");
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      });
      source.addEventListener("error", (error) => {
        onStatus("reconnecting", error);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("无法建立事件通道"));
        }
      });
    });
  }

  return Object.freeze({ open, close, get source() { return source; } });
}
