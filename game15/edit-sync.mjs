// Serialize edit/reset acknowledgements without treating a failed request as sent.
export function createEditSynchronizer({ getState, send, onChange = () => {} }) {
  let key = null, pending = null, awaiting = null, error = "";
  function reconcile() {
    const state = getState();
    if (state.key !== key) {
      key = state.key;
      pending = awaiting = null;
      error = "";
    }
    if (awaiting && state.edited === awaiting.desired) awaiting = null;
    if (state.edited === state.dirty) error = "";
    return state;
  }
  function sync({ retry = false } = {}) {
    const state = reconcile();
    if (retry) error = "";
    if (!key || pending || awaiting || error || state.edited === state.dirty) return;
    const request = { key, desired: state.dirty };
    pending = request;
    onChange();
    Promise.resolve().then(() => {
      if (pending === request && getState().key === request.key) return send({ type: request.desired ? "beginEdit" : "resetEdit" });
    })
      .then(() => {
        const current = reconcile();
        if (pending === request && current.edited !== request.desired) awaiting = request;
      }, failure => {
        const current = reconcile();
        // SSE can confirm an action even when its HTTP response was lost.
        if (pending === request && current.edited !== request.desired && current.edited !== current.dirty) {
          error = failure?.message || "连接暂时不可用";
        }
      }).finally(() => {
        if (pending !== request) return; // A response from an expired turn.
        pending = null;
        reconcile();
        onChange();
        sync(); // An undo during the request may now require resetEdit.
      });
  }
  return {
    sync,
    observe() { reconcile(); sync(); },
    status() { return { pending: Boolean(pending || awaiting), error }; }
  };
}
