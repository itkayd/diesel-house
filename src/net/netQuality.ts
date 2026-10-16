import { supabase } from './supabase';

// How good this device's connection is right now: Poor, Strong or Super strong. Shared with everyone
// (presence) so friends can see who is on a bad line. Measured from:
// - the Realtime heartbeat round trip (every 25 s, free: no extra messages),
// - voice calls in a room: round-trip time and lost audio packets (getStats, see voice.ts),
// - the phone's own hint (Android Chrome: 2g/3g), and whether it's offline at all.
// Friends are in the UK, Middle East and US and the server is in London, so 150 ms is still great.

export type NetQuality = 'poor' | 'strong' | 'super';
export const NET_LABEL: Record<NetQuality, string> = { poor: 'Poor', strong: 'Strong', super: 'Super strong' };

const SUPER_RTT = 150; // ms
const STRONG_RTT = 400;
const SUPER_LOSS = 0.01; // fraction of audio packets lost
const STRONG_LOSS = 0.05;

type Connection = { effectiveType?: string; addEventListener?: (t: string, f: () => void) => void };

class NetMonitor {
  private beats: number[] = []; // last few heartbeat round trips (ms)
  private beatFailed = false;
  private call: { rtt: number; loss: number; at: number } | null = null;
  private current: NetQuality | null = null;
  private listeners = new Set<(q: NetQuality) => void>();

  start() {
    supabase?.realtime.onHeartbeat((status, latency) => {
      if (status === 'ok' && typeof latency === 'number') {
        this.beatFailed = false;
        this.beats = [...this.beats.slice(-3), latency];
      } else if (status === 'timeout' || status === 'error' || status === 'disconnected') {
        this.beatFailed = true;
      }
      this.update();
    });
    addEventListener('online', () => this.update());
    addEventListener('offline', () => this.update());
    (navigator as Navigator & { connection?: Connection }).connection?.addEventListener?.('change', () => this.update());
    void this.firstReading();
  }

  // The first heartbeat can be 25 s away, so time two tiny requests to the server now (the second one,
  // as the first includes setting up the connection) for a rating within a couple of seconds.
  private async firstReading() {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    let rtt = 0;
    for (let i = 0; i < 2; i++) {
      const t = performance.now();
      try {
        await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: 'no-store' });
      } catch {
        return;
      }
      rtt = performance.now() - t;
    }
    if (!this.beats.length) {
      this.beats = [rtt];
      this.update();
    }
  }

  // From voice calls: average round trip (ms) and packet loss across the people we're connected to.
  setCallStats(rtt: number, loss: number) {
    this.call = { rtt, loss, at: Date.now() };
    this.update();
  }

  get quality(): NetQuality | null {
    return this.current;
  }

  onChange(f: (q: NetQuality) => void) {
    this.listeners.add(f);
    if (this.current) f(this.current);
  }

  private compute(): NetQuality | null {
    if (!navigator.onLine || this.beatFailed) return 'poor';
    const call = this.call && Date.now() - this.call.at < 15_000 ? this.call : null;
    const beat = this.beats.length ? [...this.beats].sort((a, b) => a - b)[Math.floor(this.beats.length / 2)] : null;
    if (beat === null && !call) return null; // nothing measured yet
    const rtt = Math.max(beat ?? 0, call?.rtt ?? 0);
    const loss = call?.loss ?? 0;
    const hint = (navigator as Navigator & { connection?: Connection }).connection?.effectiveType;
    let q: NetQuality = rtt <= SUPER_RTT && loss <= SUPER_LOSS ? 'super' : rtt <= STRONG_RTT && loss <= STRONG_LOSS ? 'strong' : 'poor';
    if (hint === 'slow-2g' || hint === '2g') q = 'poor';
    else if (hint === '3g' && q === 'super') q = 'strong';
    return q;
  }

  private update() {
    const q = this.compute();
    if (!q || q === this.current) return;
    this.current = q;
    for (const f of this.listeners) f(q);
  }
}

export const net = new NetMonitor();
