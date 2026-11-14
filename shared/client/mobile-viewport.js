// A virtual keyboard often shrinks only the visual viewport, not 100dvh.
// Keep zoom under user control: a pinched viewport must not reflow the table.
export function keyboardViewport({ height, layoutHeight, offsetTop = 0, scale = 1, editing }) {
  const active = Boolean(editing && Math.abs(scale - 1) < 0.05 && layoutHeight - height > 120);
  return { active, height: Math.max(1, height), top: Math.max(0, offsetTop) };
}

export function bindMobileViewport(win = window, doc = document) {
  const viewport = win.visualViewport;
  if (!viewport) return () => {};
  const root = doc.documentElement;
  let frame = 0;
  const editable = (node) => node?.matches?.('textarea, input:not([type=radio]):not([type=checkbox]):not([type=button]):not([type=submit]), [contenteditable="true"]') && !node.readOnly && !node.disabled;
  function update() {
    frame = 0;
    const state = keyboardViewport({ height: viewport.height, offsetTop: viewport.offsetTop,
      scale: viewport.scale, layoutHeight: root.clientHeight, editing: editable(doc.activeElement) });
    root.toggleAttribute('data-keyboard-open', state.active);
    if (state.active) {
      root.style.setProperty('--keyboard-height', `${state.height}px`);
      root.style.setProperty('--keyboard-top', `${state.top}px`);
      doc.activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      if (!doc.querySelector('body[data-play-layout] #roomPanel:not(.hidden)')) {
        const rect = doc.activeElement.getBoundingClientRect();
        if (rect.bottom > state.top + state.height) win.scrollBy({ top: rect.bottom - state.top - state.height + 16, behavior: 'instant' });
      }
    } else {
      root.style.removeProperty('--keyboard-height');
      root.style.removeProperty('--keyboard-top');
    }
  }
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  doc.addEventListener('focusin', schedule);
  doc.addEventListener('focusout', schedule);
  schedule();
  return () => {
    win.cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    doc.removeEventListener('focusin', schedule);
    doc.removeEventListener('focusout', schedule);
    root.removeAttribute('data-keyboard-open');
    root.style.removeProperty('--keyboard-height');
    root.style.removeProperty('--keyboard-top');
  };
}

if (typeof document !== 'undefined' && document.querySelector('body[data-play-layout], body[data-mobile-input]')) {
  bindMobileViewport();
}
