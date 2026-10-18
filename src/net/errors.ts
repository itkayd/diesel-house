import { supabase } from './supabase';

// Errors on friends' phones, sent to the client_errors table (BUGS.md #13, REDESIGN.md R1) so Diesel can
// see what went wrong without anyone having to describe it. Catches uncaught errors, failed promises and
// frames the game skipped (src/game.ts). Each different message is sent once per visit, at most 10 a
// visit; the database also caps it at 20 an hour per person. Only once signed in (the database refuses
// strangers). Nothing in dev mode: there the console is enough.

const sent = new Set<string>();
const MAX_PER_VISIT = 10;
let ready = false;
const early: [string, string | undefined][] = [];

// The version of the game: the hashed name of the main file (the same for everyone on one deploy).
const build = () => document.querySelector<HTMLScriptElement>('script[src*="/assets/main-"]')?.src.match(/main-[\w-]+/)?.[0] ?? 'dev';

export function reportError(message: string, stack?: string) {
  if (import.meta.env.DEV || !supabase) return;
  const key = message.slice(0, 200);
  if (sent.has(key) || sent.size >= MAX_PER_VISIT) return;
  if (!ready) {
    if (early.length < MAX_PER_VISIT) early.push([message, stack]);
    return;
  }
  sent.add(key);
  void supabase
    .rpc('report_error', { message, stack: stack ?? null, page: location.pathname + location.search, agent: navigator.userAgent, build: build() })
    .then(() => {}, () => {});
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
}

// Signed in: send what happened before, and from now on as it happens.
export function errorReportsReady() {
  ready = true;
  for (const [m, s] of early.splice(0)) reportError(m, s);
}
