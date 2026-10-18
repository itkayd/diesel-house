import { chromium } from 'playwright-core';
// BUGS.md #1: an error in one frame must not freeze the game. Makes the house throw for a few frames on
// purpose, then checks frames keep coming and you can still walk. Runs in dev test mode (no Supabase
// needed). Set DH_CHROMIUM to use a Chromium instead of Edge.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Sturdy');
  localStorage.setItem('diesel-house.character', '4');
});
const page = await ctx.newPage();
const logged = [];
page.on('console', (m) => m.type() === 'error' && /Frame skipped/.test(m.text()) && logged.push(m.text()));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && !document.getElementById('picker'), null, { timeout: 20000 });

const frame = () => page.evaluate(() => window.__house.game.loop.frame);
// Throw from the scene's update for 5 frames (as if a bug hit).
await page.evaluate(() => {
  const h = window.__house;
  let left = 5;
  const boom = () => {
    if (left-- > 0) throw new Error('test: broken frame');
    h.events.off('update', boom);
  };
  h.events.on('update', boom);
});
const f0 = await frame();
await page.waitForTimeout(800);
const f1 = await frame();
const x0 = await page.evaluate(() => window.__house.player.x);
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(500);
await page.keyboard.up('ArrowRight');
const x1 = await page.evaluate(() => window.__house.player.x);
check('an error in a frame is skipped: frames keep coming, you can still walk, logged once', { f0, f1, moved: Math.round(x1 - x0), logged: logged.length },
  f1 - f0 > 10 && x1 - x0 > 5 && logged.length === 1);

console.log(res.join('\n'));
await browser.close();
if (res.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
