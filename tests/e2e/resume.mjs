import { chromium } from 'playwright-core';
// After a phone sleeps (tab hidden, socket dropped) everyone is back within 3 s without a reload; players
// who go silent for 30 s disappear and come back when they send anything. Runs in dev test mode.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 650 } });
  await ctx.addInitScript((n) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', '16');
    // Lets the test say whether the tab is hidden (like a phone going to sleep).
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') });
    window.__setHidden = (h) => {
      hidden = h;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebSocket|ERR_INTERNET_DISCONNECTED|net::/.test(m.text()) && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { name, ctx, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const where = (p, id) => p.page.evaluate((id) => {
  const r = window.__house.remotes.get(id);
  return r ? { active: r.active, x: Math.round(r.avatar.sprite.x), y: Math.round(r.avatar.sprite.y) } : null;
}, id);
const A = await player('Alice wake');
const B = await player('Bob wake');
await A.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, B.id, { timeout: 15000 });

// 1. A's phone sleeps: hidden, and its socket is gone. B walks somewhere else meanwhile.
await A.page.evaluate(async () => {
  window.__setHidden(true);
  (await import('/src/net/supabase.ts')).supabase.realtime.disconnect();
});
await B.page.evaluate(() => { window.__house.body.reset(400, 270); window.__house.sendMove(true); });
await A.page.waitForTimeout(12000); // asleep long enough to count as stale
const before = await A.page.evaluate(() => window.__house.msgStats.reconnects);
const woke = Date.now();
// A real sleeping phone's socket is dead on waking (timers were frozen, so nothing reconnected meanwhile).
await A.page.evaluate(async () => {
  (await import('/src/net/supabase.ts')).supabase.realtime.disconnect();
  window.__setHidden(false);
});
const sawPill = await A.page.waitForFunction(() => /Reconnecting/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 2000 }).then(() => true, () => false);
const back = await A.page
  .waitForFunction((id) => {
    const r = window.__house.remotes.get(id);
    return r?.active && Math.abs(r.avatar.sprite.x - 400) < 2 && Math.abs(r.avatar.sprite.y - 270) < 2;
  }, B.id, { timeout: 8000 })
  .then(() => Date.now() - woke, () => null);
await A.page.waitForFunction(() => /in the house/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
const after = { reconnects: await A.page.evaluate(() => window.__house.msgStats.reconnects), status: await A.page.evaluate(() => document.getElementById('status')?.textContent) };
check('phone wakes after sleeping: reconnects (counted), friends are back where they really are within 3 s', { sawPill, ms: back, ...after, before }, sawPill && back !== null && back <= 3000 && after.reconnects > before && /in the house/.test(after.status));
const bSeesA = await B.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 5000 }).then(() => true, () => false);
check('and the friends see the woken phone again too', { bSeesA }, bSeesA);

// 2. B goes silent (loses internet): after 30 s A hides B; B's internet comes back and B reappears.
await B.ctx.setOffline(true);
const gone = await A.page.waitForFunction((id) => !window.__house.remotes.get(id)?.active, B.id, { timeout: 45000 }).then(() => true, () => false);
await B.ctx.setOffline(false);
await B.page.evaluate(() => dispatchEvent(new Event('online')));
const returned = await A.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, B.id, { timeout: 10000 }).then(() => true, () => false);
check('someone silent for 30 s disappears, and comes back as soon as they send anything', { gone, returned }, gone && returned);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
