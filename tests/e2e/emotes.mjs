import { chromium } from 'playwright-core';
// UPDATE.md Phase 11: emotes and the tap-a-friend menu. An emote shows over the sender's head on both
// screens within ~300 ms, spamming is capped (1 per 2 s), keys 1-6 and Q work, and it works on a phone.
// Dev test mode (its own house).
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
async function player(name, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 900, height: 650 } });
  await ctx.addInitScript((n) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', '16');
  }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const at = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const sees = (p, other) => p.page.waitForFunction((id) => { const r = window.__house.remotes.get(id); return r?.active && r.avatar.sprite.visible; }, other.id, { timeout: 15000 });
// On `p`, the time (Date.now) at which `other`'s avatar first shows emote `e`.
const watch = (p, other, e) =>
  p.page.evaluate(([id, e]) => new Promise((done) => {
    const t0 = Date.now();
    const tick = () => {
      if (window.__house.remotes.get(id)?.avatar.emote === e) return done(Date.now());
      if (Date.now() - t0 > 4000) return done(null);
      requestAnimationFrame(tick);
    };
    tick();
  }), [other.id, e]);
const received = (p) => p.page.evaluate(() => window.__house.msgStats.totals['received:emote'] ?? 0);
const sent = (p) => p.page.evaluate(() => window.__house.msgStats.totals['sent:emote'] ?? 0);

const A = await player('Ann emote');
const B = await player('Ben emote');
await at(A, 520, 520);
await at(B, 550, 520);
await sees(A, B);
await sees(B, A);

// 1. Key 1 on A: a wave over A's head, on A's screen and on B's.
{
  const seen = watch(B, A, 'faceHappy');
  await A.page.waitForTimeout(100);
  const t = Date.now();
  await A.page.keyboard.press('1');
  const at2 = await seen;
  const mine = await A.page.evaluate(() => window.__house.me.emote);
  check('key 1: a wave over your head, and on the other screen within ~300 ms', { mine, ms: at2 && at2 - t }, mine === 'faceHappy' && at2 !== null && at2 - t < 600);
  await A.page.waitForTimeout(2600);
  const gone = await A.page.evaluate(() => window.__house.me.emote);
  check('it goes away after about 2.5 s', { emote: gone }, gone === null);
}

// 2. Spam: 6 quick presses send one emote, and the other side shows one.
{
  const s0 = await sent(A);
  const r0 = await received(B);
  for (const k of ['2', '3', '4', '5', '6', '2']) {
    await A.page.keyboard.press(k);
    await A.page.waitForTimeout(120);
  }
  await B.page.waitForTimeout(800);
  const s = (await sent(A)) - s0;
  const r = (await received(B)) - r0;
  const shown = await B.page.evaluate((id) => window.__house.remotes.get(id).avatar.emote, A.id);
  check('spamming keys: only 1 emote per 2 s is sent', { sent: s, received: r, shown }, s === 1 && r === 1 && shown === 'laugh');
}

// 3. Typing in a box never sends emotes.
{
  await A.page.waitForTimeout(2100);
  const s0 = await sent(A);
  await A.page.evaluate(() => {
    const i = document.createElement('input');
    i.id = 'typing-test';
    document.body.append(i);
    i.focus();
  });
  await A.page.keyboard.type('123');
  await A.page.waitForTimeout(300);
  const s = (await sent(A)) - s0;
  await A.page.evaluate(() => document.getElementById('typing-test').remove());
  check('typing 1, 2, 3 in a text box sends no emotes', { sent: s }, s === 0);
}

// 4. Tap B's character on A: the friend menu (where they are, emotes, Duel coming soon); send a heart.
{
  const spot = await A.page.evaluate((id) => {
    const h = window.__house;
    const s = h.remotes.get(id).avatar.sprite;
    const cam = h.cameras.main;
    const c = h.game.canvas.getBoundingClientRect();
    return { x: c.left + (s.x - cam.worldView.x) * cam.zoom, y: c.top + (s.y - 12 - cam.worldView.y) * cam.zoom };
  }, B.id);
  const before = await A.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
  await A.page.mouse.click(spot.x, spot.y);
  const open = await A.page.waitForSelector('#friend-menu', { timeout: 3000 }).then(() => true, () => false);
  const menu = await A.page.evaluate(() => ({
    where: document.getElementById('friend-where')?.textContent ?? null,
    emotes: document.querySelectorAll('#friend-menu [data-emote]').length,
    duel: document.getElementById('friend-duel')?.disabled,
    slider: !!document.getElementById('volume-slider'),
  }));
  check('tapping a friend opens their menu: where they are, 10 emotes, Duel, no volume outside a call', { open, ...menu }, open && menu.emotes === 10 && menu.duel === false && !menu.slider && /whisper/.test(menu.where ?? ''));
  const seen = watch(B, A, 'hearts');
  await A.page.click('#friend-menu [data-emote="hearts"]');
  const got = await seen;
  const after = await A.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
  const closed = !(await A.page.locator('#friend-menu').count());
  check('a heart from the menu shows on both screens; the menu closes and the tap did not walk you', { got: !!got, closed, moved: after.x !== before.x || after.y !== before.y }, !!got && closed && after.x === before.x && after.y === before.y);
}

// 5. Q next to someone opens their menu; Q with nobody near does nothing.
{
  await A.page.keyboard.press('q');
  const open = await A.page.waitForSelector('#friend-menu', { timeout: 2000 }).then(() => true, () => false);
  const name = await A.page.evaluate(() => document.getElementById('friend-menu')?.getAttribute('aria-label'));
  await A.page.mouse.click(20, 600);
  await at(A, 500, 520);
  await A.page.waitForTimeout(300);
  await A.page.keyboard.press('q');
  await A.page.waitForTimeout(400);
  const far = await A.page.locator('#friend-menu').count();
  check('Q next to Ben opens his menu; Q with nobody near does nothing', { open, name, far }, open && name === 'Ben emote' && far === 0);
}

// 6. On a phone: the emote button opens the bar, which fits on screen; a tap sends it.
{
  const P = await player('Pia phone', true);
  await at(P, 520, 520);
  await sees(A, P);
  await P.page.waitForTimeout(500);
  await P.page.tap('#emote-button');
  const bar = await P.page.waitForSelector('#emote-bar', { timeout: 2000 }).then(() => true, () => false);
  const box = await P.page.evaluate(() => {
    const r = document.getElementById('emote-bar').getBoundingClientRect();
    const b = document.querySelector('#emote-bar [data-emote]').getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, w: innerWidth, h: innerHeight, btn: Math.round(b.width) };
  });
  const seen = watch(A, P, 'sleep');
  const t = Date.now();
  await P.page.tap('#emote-bar [data-emote="sleep"]');
  const got = await seen;
  const closed = !(await P.page.locator('#emote-bar').count());
  check('phone: emote button opens the bar on screen (big enough buttons); a tap shows it to others', { bar, ...box, ms: got && got - t, closed },
    bar && box.left >= 0 && box.right <= box.w && box.top >= 0 && box.btn >= 36 && got !== null && got - t < 600 && closed);
  // Tapping someone on a touch screen opens the menu too.
  await at(P, 600, 540);
  await P.page.waitForTimeout(1000); // the camera glides after a teleport
  const spot = await P.page.evaluate((id) => {
    const h = window.__house;
    const s = h.remotes.get(id).avatar.sprite;
    const cam = h.cameras.main;
    const c = h.game.canvas.getBoundingClientRect();
    return { x: c.left + (s.x - cam.worldView.x) * cam.zoom, y: c.top + (s.y - 12 - cam.worldView.y) * cam.zoom };
  }, B.id);
  await P.page.touchscreen.tap(spot.x, spot.y);
  const open = await P.page.waitForSelector('#friend-menu', { timeout: 3000 }).then(() => true, () => false);
  const fits = await P.page.evaluate(() => { const r = document.getElementById('friend-menu')?.getBoundingClientRect(); return r ? r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight : false; });
  check('phone: tapping a friend opens their menu, and it fits on screen', { open, fits }, open && fits);
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
