import { recordEvents, type GameEvent, type Recorded } from '../net/progress';

// Collects what you do (entered a room, sent an emote, won a game…) and sends it to record_events() in
// one batch at most every 30 s (UPDATE.md Phase 14), plus once when you arrive and when the tab is
// hidden. The same event about the same thing is merged ("emote_sent ×3"). Guests and dev test mode
// don't record anything (`enabled` false).

const EVERY_MS = 30_000;
const SOON_MS = 2_000; // the first batch after a quiet spell goes out quickly
const MAX_QUEUED = 300;

export class Tracker {
  private queue = new Map<string, GameEvent>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  private busy = false;
  private listeners = new Set<(r: Recorded) => void>();
  last: Recorded | null = null;

  constructor(readonly enabled: boolean) {}

  start() {
    if (!this.enabled) return;
    void this.flush(); // arrival: streak, first in the house, today's challenges
    document.addEventListener('visibilitychange', () => document.hidden && void this.flush());
    window.addEventListener('pagehide', () => void this.flush());
  }

  onResult(f: (r: Recorded) => void) {
    this.listeners.add(f);
    if (this.last) f(this.last);
  }

  emit(k: string, opts: { n?: number; u?: string } = {}) {
    if (!this.enabled) return;
    const key = `${k}|${opts.u ?? ''}`;
    const e = this.queue.get(key);
    if (e) e.n = Math.min(60, (e.n ?? 1) + (opts.n ?? 1));
    else if (this.queue.size < MAX_QUEUED) this.queue.set(key, { k, ...(opts.n ? { n: opts.n } : {}), ...(opts.u ? { u: opts.u } : {}) });
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    const wait = Math.max(SOON_MS, this.lastSent + EVERY_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  async flush() {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    const batch = [...this.queue.values()];
    this.queue.clear();
    this.lastSent = Date.now();
    try {
      const r = await recordEvents(batch);
      if (r) {
        this.last = r;
        for (const f of this.listeners) f(r);
      }
    } catch {
      // Offline or a hiccup: put them back for next time.
      for (const e of batch) if (this.queue.size < MAX_QUEUED) this.queue.set(`${e.k}|${e.u ?? ''}`, e);
    } finally {
      this.busy = false;
      if (this.queue.size) this.schedule();
    }
  }
}
