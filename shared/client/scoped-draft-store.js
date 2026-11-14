// One current draft per game in this tab. Storage denial must not block play.
export function createScopedDraftStore(gameId, storage = () => globalThis.sessionStorage) {
  const key = `tablegame:draft:${gameId}`;
  function clear() { try { storage()?.removeItem(key); } catch {} }
  return {
    clear,
    save(context, value) {
      if (!context) return clear();
      try { storage()?.setItem(key, JSON.stringify({ version: 1, context, value })); } catch {}
    },
    load(context) {
      try {
        const saved = JSON.parse(storage()?.getItem(key) || "null");
        if (context && saved?.version === 1 && saved.context === context) return saved.value;
      } catch {}
      clear();
      return null;
    }
  };
}
