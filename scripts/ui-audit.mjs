// Screenshots of every main screen, phone and desktop, for a UI review (dev server on :5173, test mode).
// Run: DH_CHROMIUM=/opt/pw-browsers/chromium node scripts/ui-audit.mjs <out dir>
// AXE=1 also runs an axe-core accessibility scan (WCAG 2.1 A + AA) on each screen and writes axe.json.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const AXE = process.env.AXE ? readFileSync('node_modules/axe-core/axe.min.js', 'utf8') : null;
const axe = {};
const out = process.argv[2] ?? 'ui-audit';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const only = process.env.ONLY?.split(',');
const errors = [];

async function session(label, viewport, mobile, { fresh = false, test = true } = {}) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  if (!fresh)
    await ctx.addInitScript(() => {
      localStorage.setItem('diesel-house.name', 'Diesel');
      localStorage.setItem('diesel-house.character', 'ninja.villager2');
      localStorage.setItem('diesel-house.mic-ok', '1');
      localStorage.setItem('diesel-house.guide-seen', '1');
      localStorage.setItem('diesel-house.rules-seen', '["quiz","sketch","liars","letters","quickdraw","higherlower","wyr","four","dice","rps","nightraid"]');
    });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`http://localhost:5173/${test ? '?test' : ''}`);
  const shot = async (name) => {
    if (only && !only.includes(name)) return;
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${label}-${name}.png` });
    if (AXE) {
      await page.evaluate(AXE);
      axe[`${label}-${name}`] = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, exclude: [['canvas']] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, nodes: v.nodes.slice(0, 4).map((n) => ({ t: n.target.join(' '), why: n.failureSummary?.split('\n').slice(1, 2).join(' ') })) }));
      });
    }
  };
  return { ctx, page, shot };
}
const clear = (page) => page.evaluate(() => { document.querySelectorAll('.dh-scrim').forEach((s) => s.remove()); document.querySelectorAll('.dh-toast').forEach((t) => t.remove()); });
const people = (page) =>
  page.evaluate(() => {
    const h = window.__house;
    const add = (id, name, character, dx, dy, lv) => {
      h.addRemote({ id, name, character, zone: 'hallway', lv, st: 3 });
      h.receiveMove({ id, x: h.player.x + dx, y: h.player.y + dy, vx: 0, vy: 0, dir: 'down', zone: 'hallway', t: Date.now() });
    };
    add('zara-1', 'Zara', 'ninja.princess', 28, 0, 23);
    add('bo-2', 'Bo', 'ninja.oldman', -30, 10, 7);
  });

for (const [label, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1366, height: 800 }, false]]) {
  // Login (no session, no test mode).
  {
    const { ctx, page, shot } = await session(label, viewport, mobile, { test: false });
    await page.waitForSelector('#login-screen', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await shot('01-login');
    await ctx.close();
  }
  // First visit: the picker.
  {
    const { ctx, page, shot } = await session(label, viewport, mobile, { fresh: true });
    await page.waitForSelector('#picker', { timeout: 20000 }).catch(() => {});
    await shot('02-picker');
    await ctx.close();
  }
  const { ctx, page, shot } = await session(label, viewport, mobile);
  await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await clear(page);
  await people(page);
  await page.waitForTimeout(500);
  await shot('03-hall');
  // In a room with the chat.
  await page.evaluate(() => { const h = window.__house; const z = h.zones.box('lounge'); h.body.reset(z.x + z.w / 2, z.y + z.h / 2); h.player.setPosition(z.x + z.w / 2, z.y + z.h / 2); });
  await page.waitForTimeout(1500);
  await clear(page);
  await shot('04-room');
  await page.click('#chat-button').catch(() => {});
  await shot('05-chat');
  await clear(page);
  // Games.
  await page.evaluate(() => { const h = window.__house; h.body.reset(723, 525); h.player.setPosition(723, 525); });
  await page.waitForSelector('#game-prompt', { timeout: 8000 }).catch(() => {});
  await shot('06-game-prompt');
  await page.click('#game-prompt').catch(() => {});
  await shot('07-games');
  await page.click('[data-game="quiz"]').catch(() => {});
  await shot('08-quiz-lobby');
  await clear(page);
  // Settings tabs.
  for (const t of ['sound', 'mic', 'room', 'more']) {
    await page.click('#settings-button').catch(() => {});
    await page.click(`#settings-tab-${t}`).catch(() => {});
    await shot(`09-settings-${t}`);
    await clear(page);
  }
  // Profile, map, challenges, messages, guide, friend menu, someone's profile, arcade.
  await page.evaluate(() => window.__house.openMyProfile());
  await shot('10-my-profile');
  await clear(page);
  await page.click('#map-button').catch(() => {});
  await shot('11-map');
  await clear(page);
  await page.click('#challenges-button').catch(() => {});
  await shot('12-challenges');
  await clear(page);
  await page.click('#messages-button').catch(() => {});
  await shot('13-messages');
  await clear(page);
  await page.click('#guide-button').catch(() => {});
  await shot('14-guide');
  await clear(page);
  await page.evaluate(() => { const h = window.__house; h.body.reset(723, 600); h.player.setPosition(723, 600); });
  await page.waitForTimeout(500);
  await people(page);
  await page.evaluate(() => window.__house.tapAvatar('zara-1'));
  await shot('15-friend-menu');
  await page.evaluate(() => window.__house.openProfileOf('zara-1', 'Zara'));
  await shot('16-their-profile');
  await clear(page);
  await page.evaluate(() => window.__house.openArcade());
  await page.waitForSelector('#arcade-play', { timeout: 8000 }).catch(() => {});
  await shot('17-arcade');
  await ctx.close();
}
if (AXE) {
  writeFileSync(`${out}/axe.json`, JSON.stringify(axe, null, 1));
  for (const [screen, vs] of Object.entries(axe)) console.log(screen, vs.length ? vs.map((v) => `${v.id}(${v.n})`).join(' ') : 'clean');
}
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
