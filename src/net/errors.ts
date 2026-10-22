import { supabase } from './supabase';

// Device logs (supabase/migrations/20261111_device_logs.sql): what goes wrong on people's phones, sent to
// the client_errors table so it can be fixed from the admin page without anyone having to describe it.
//   error    a crash: uncaught errors, failed promises, frames the game skipped (src/game.ts)
//   warning  something odd the game noticed and fixed by itself (a stuck joystick let go, movement
//            switched back on): rare on a healthy phone, so a pattern here points at a real bug
//   problem  a feature failed: the mic, voice, saving a score
//   report   "Report a problem" in Settings → More, with the player's own words
// Every log carries the device (screen, touch, browser, connection…) and a trail of the last 40 things
// that happened (rooms, joystick, pop-ups, connection), so a bug can be followed step by step. Each
// different message is sent once per visit, at most 20 a visit; the database caps it at 30 an hour per
// person. Only once signed in (the database refuses strangers). Nothing in dev mode.

export type LogKind = 'error' | 'warning' | 'problem' | 'report';

const sent = new Set<string>();
const MAX_PER_VISIT = 20;
let ready = false;
const early: { kind: LogKind; message: string; stack?: string; extra?: Record<string, unknown> }[] = [];

// The version of the game: the hashed name of the main file (the same for everyone on one deploy).
const build = () => document.querySelector<HTMLScriptElement>('script[src*="/assets/main-"]')?.src.match(/main-[\w-]+/)?.[0] ?? 'dev';

// The trail: the last 40 things that happened, newest last, with seconds since the page opened.
type Crumb = { t: number; what: string; info?: string };
const crumbs: Crumb[] = [];
const started = performance.now();
export function crumb(what: string, info?: string) {
  crumbs.push({ t: Math.round((performance.now() - started) / 100) / 10, what, info: info?.slice(0, 120) });
  if (crumbs.length > 40) crumbs.shift();
}

// What the phone or computer is.
function device() {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number; saveData?: boolean } };
  return {
    screen: `${screen.width}×${screen.height}`,
    viewport: `${innerWidth}×${innerHeight}`,
    dpr: devicePixelRatio,
    touch: navigator.maxTouchPoints,
    coarse: matchMedia('(pointer: coarse)').matches,
    standalone: matchMedia('(display-mode: standalone)').matches,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    memory: n.deviceMemory ?? null,
    connection: n.connection ? { type: n.connection.effectiveType, down: n.connection.downlink, saveData: n.connection.saveData } : null,
    online: navigator.onLine,
    visible: document.visibilityState,
    uptime: Math.round((performance.now() - started) / 1000),
  };
}

// Extra facts the game adds to every log (where you are, mic state…), set by the house scene.
let facts: () => Record<string, unknown> = () => ({});
export function setLogFacts(f: () => Record<string, unknown>) {
  facts = f;
}

export function logIssue(kind: LogKind, message: string, opts: { stack?: string; extra?: Record<string, unknown>; force?: boolean } = {}) {
  if (import.meta.env.DEV || !supabase) return;
  const key = `${kind}:${message.slice(0, 200)}`;
  if (!opts.force && (sent.has(key) || sent.size >= MAX_PER_VISIT)) return;
  if (!ready) {
    if (early.length < MAX_PER_VISIT) early.push({ kind, message, stack: opts.stack, extra: opts.extra });
    return;
  }
  sent.add(key);
  let game: Record<string, unknown> = {};
  try {
    game = facts();
  } catch {
    // never let logging break anything
  }
  const context = { device: device(), game, extra: opts.extra ?? null, trail: [...crumbs] };
  void supabase
    .rpc('report_issue', { kind, message, stack: opts.stack ?? null, page: location.pathname + location.search, agent: navigator.userAgent, build: build(), context })
    .then(
      ({ error }) => {
        // An older database (before 20261111): the plain error log.
        if (error && kind === 'error') void supabase!.rpc('report_error', { message, stack: opts.stack ?? null, page: location.pathname, agent: navigator.userAgent, build: build() });
      },
      () => {},
    );
}

// Crashes (kept for the callers that already use it).
export function reportError(message: string, stack?: string) {
  crumb('error', message);
  logIssue('error', message, { stack });
}

// Start listening (main.ts, as early as possible).
export function installErrorReports() {
  window.addEventListener('error', (e) => {
    if (!e.message) return; // a picture or sound that failed to load: not a bug in the game
    reportError(e.message, e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportError(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
  // The trail: the page going to the back and coming back, the connection dropping.
  document.addEventListener('visibilitychange', () => crumb(document.hidden ? 'page hidden' : 'page shown'));
  addEventListener('online', () => crumb('online'));
  addEventListener('offline', () => crumb('offline'));
  addEventListener('orientationchange', () => crumb('turned', `${innerWidth}×${innerHeight}`));
  addEventListener('pagehide', () => crumb('page closing'));
}

// Signed in: send what happened before, and from now on as it happens.
export function errorReportsReady() {
  ready = true;
  for (const e of early.splice(0)) logIssue(e.kind, e.message, { stack: e.stack, extra: e.extra });
}
