// The page itself must never zoom: it's a game, and a zoomed page hides the HUD and joystick. iPhones ignore
// `user-scalable=no`, so a quick double tap (joystick, map, buttons) or a pinch zoomed the whole page.
// This blocks double-tap and pinch zoom, and if the page ends up zoomed anyway, puts it back.

const CONTROLS = 'button, [role=button], a[href], label, input, select, textarea';
const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest(CONTROLS);
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');

// Text that may still be selected (and long-pressed): typing, chat messages, codes to copy.
const SELECTABLE = 'input, textarea, select, [contenteditable], #msgs .text, .dh-selectable';
const selectable = (t: EventTarget | null) => t instanceof Element && !!t.closest(SELECTABLE);

// No text selection or long-press menu over the game: holding the joystick or a button highlighted the
// HUD text and opened "Copy / Search", which stole the touch and locked the joystick.
export function installNoSelect() {
  document.addEventListener('selectstart', (e) => !selectable(e.target) && e.preventDefault());
  document.addEventListener('contextmenu', (e) => !selectable(e.target) && e.preventDefault());
  // If a selection still appears (e.g. iOS double-tap), clear it unless it's in allowed text.
  document.addEventListener('selectionchange', () => {
    if (isTyping(document.activeElement)) return; // selections inside text boxes are fine
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && !selectable(sel.anchorNode?.parentElement ?? null)) sel.removeAllRanges();
  });
}

export function installNoZoom() {
  // iPhone pinch (Safari's own gesture events).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

  // Two-finger pinch elsewhere.
  document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

  // Double tap: a second tap within 350 ms in about the same spot would zoom, so it doesn't get the
  // browser's default. (Only the same spot: a quick tap on a different button, like an emote straight after
  // the emote button, must still be a click.) Never on buttons and other controls: cancelling the touch
  // there also cancels the click, so a quick second tap (Higher twice, Roll again) did nothing. They
  // can't zoom anyway (touch-action: manipulation, theme.css).
  let lastTap = { t: 0, x: 0, y: 0 };
  document.addEventListener(
    'touchend',
    (e) => {
      const p = e.changedTouches[0];
      const tap = { t: Date.now(), x: p?.clientX ?? 0, y: p?.clientY ?? 0 };
      if (tap.t - lastTap.t < 350 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 40 && !isTyping(e.target) && !isControl(e.target)) e.preventDefault();
      lastTap = tap;
    },
    { passive: false },
  );
  document.addEventListener('dblclick', (e) => !isTyping(e.target) && e.preventDefault());

  // Zoomed anyway (e.g. by an accessibility setting or before this loaded): snap back to 1x.
  const vv = window.visualViewport;
  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
  if (vv && meta) {
    const base = meta.content;
    vv.addEventListener('resize', () => {
      if (vv.scale <= 1.01 || isTyping(document.activeElement)) return;
      meta.content = `${base}, maximum-scale=1`;
      setTimeout(() => (meta.content = base), 300);
    });
  }
}
