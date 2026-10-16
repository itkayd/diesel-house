// The page itself must never zoom: it's a game, and a zoomed page hides the HUD and joystick. iPhones ignore
// `user-scalable=no`, so a quick double tap (joystick, map, buttons) or a pinch zoomed the whole page.
// This blocks double-tap and pinch zoom, and if the page ends up zoomed anyway, puts it back.

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');

export function installNoZoom() {
  // iPhone pinch (Safari's own gesture events).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

  // Two-finger pinch elsewhere.
  document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

  // Double tap: a second tap within 350 ms would zoom, so it doesn't get the browser's default.
  let lastTap = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTap < 350 && !isTyping(e.target)) e.preventDefault();
      lastTap = now;
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
