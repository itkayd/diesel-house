// Counts Realtime broadcasts so we can keep an eye on the free tier (2M messages/month; each broadcast
// costs 1 to send + 1 per receiver). Dev builds expose it as window.__house.msgStats.

type Dir = 'sent' | 'received';
const events: { t: number; dir: Dir; kind: string }[] = [];
const totals: Record<string, number> = {};

export function countMessage(dir: Dir, kind: string) {
  const t = Date.now();
  events.push({ t, dir, kind });
  while (events.length && events[0].t < t - 60_000) events.shift();
  totals[`${dir}:${kind}`] = (totals[`${dir}:${kind}`] ?? 0) + 1;
}

let reconnects = 0;
export const countReconnect = () => void reconnects++;

export const msgStats = {
  // Times the house connection was rebuilt (phone woke up, network came back, channel dropped).
  get reconnects() {
    return reconnects;
  },
  // Messages in the last minute.
  get lastMinute() {
    const since = Date.now() - 60_000;
    const recent = events.filter((e) => e.t >= since);
    return { sent: recent.filter((e) => e.dir === 'sent').length, received: recent.filter((e) => e.dir === 'received').length };
  },
  // Since the page loaded, by direction and kind, e.g. { 'sent:move': 12 }.
  get totals() {
    return { ...totals };
  },
};
