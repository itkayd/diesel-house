import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Needs the dev server running (npm run dev). Screenshots go to tests/e2e/output.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const res = []; const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1')); // mic card is tested in audio.mjs
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => window.__house?.player);
const st = () => page.evaluate(() => { const h = window.__house; return { x: Math.round(h.player.x), y: Math.round(h.player.y), zone: h.zone, anim: h.player.anims.currentAnim?.key, frame: h.player.frame.name, tex: h.player.texture.key }; });
const hold = async (key, ms = 2500) => { await page.keyboard.down(key); await page.waitForTimeout(ms); const during = await st(); await page.keyboard.up(key); await page.waitForTimeout(150); return { during, after: await st() }; };
const tp = (x, y) => page.evaluate(([x, y]) => window.__house.body.reset(x, y), [x, y]);

// First launch: picker
const n = await page.locator('button[data-character]').count();
check('picker shows on first launch with 20 characters', n, n === 20);
let a = await st(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight'); let b = await st();
check('cannot walk while picker is open', b, a.x === b.x);
// Portraits drawn (non-blank) — checked numerically
const blank = await page.evaluate(() => [...document.querySelectorAll('button[data-character] canvas')].filter((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }).length);
check('every portrait has a picture', blank, blank === 0);

// Picking without a name is refused
await page.click('button[data-character="5"]');
await page.click('#picker-done');
check('picker refuses to continue without a name', { error: await page.locator('#picker-error').textContent() }, (await page.locator('button[data-character]').count()) === 20);
await page.fill('#player-name', 'Tester');
// Pick chibi #6 (index 5)
await page.click('button[data-character="5"]');
await page.click('#picker-done');
b = await st(); const saved = await page.evaluate(() => localStorage.getItem('diesel-house.character'));
check('picking closes picker and saves choice', { saved, picker: await page.locator('button[data-character]').count() }, saved === '5');
check('idle faces down using chibi sheet A, character 6 middle frame', b, b.tex === 'chibis_a' && b.anim === 'char5-idle-down' && b.frame === 4 * 12 + 3 + 1);
// Walk directions → animations + frames on the right row
const rows = { down: 4, left: 5, right: 6, up: 7 };
for (const [key, dir] of [['ArrowRight', 'right'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowUp', 'up']]) {
  await tp(1040, 600); // the Disco's dance floor: open in every direction
  const frames = new Set();
  await page.keyboard.down(key);
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(110); frames.add((await st()).frame); } // (headless runs at ~20 fps)
  await page.keyboard.up(key); await page.waitForTimeout(150);
  const after = await st();
  const okRow = [...frames].every((f) => Math.floor(f / 12) === rows[dir] && f % 12 >= 3 && f % 12 <= 5);
  check(`walking ${dir}: walk anim cycles frames on the ${dir} row, then idles facing ${dir}`, { frames: [...frames], after: after.anim }, okRow && frames.size >= 2 && after.anim === `char5-idle-${dir}`);
}

// Collision with feet-based body (the octagon house, REDESIGN.md R3)
await tp(600, 520);
let r = await hold('ArrowUp'); check('hall wall blocks (feet stop below the wall face)', r.after, r.after.y === 454 && r.after.zone === 'hallway');
await tp(656, 500); r = await hold('ArrowUp', 3500); check('through the door into the garden, stops at the back hedge', r.after, r.after.zone === 'garden' && r.after.y === 230);
r = await hold('ArrowRight', 3000); check('a tree blocks on the way along the hedge (furniture blocks)', r.after, r.after.x === 729);
await tp(368, 900); r = await hold('ArrowDown', 2500); check('café (clear column), stops at the bottom wall', r.after, r.after.zone === 'cafe' && r.after.y === 1008);

// Reload: remembered, no picker
await page.reload(); await page.waitForFunction(() => window.__house?.player);
b = await st(); check('choice remembered after reload (no picker)', { n: await page.locator('button[data-character]').count(), anim: b.anim }, b.anim === 'char5-idle-down');

// Change character -> LimeZu Adam (index 16), screenshot (LimeZu art only on screen)
await page.click('#xp-chip');
check('Change character reopens picker', 0, (await page.locator('button[data-character]').count()) === 20);
await page.click('button[data-character="16"]');
await page.click('#picker-done');
r = await hold('ArrowRight', 800);
check('LimeZu Adam walks right with run strip frames 0-5', r.during, r.during.tex === 'limezu_adam_run' && r.during.frame <= 5);
r = await hold('ArrowDown', 500);
check('LimeZu Adam idles facing down (idle strip 18-23)', r.after, r.after.tex === 'limezu_adam_idle' && r.after.frame >= 18);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/p2_adam.png` });
console.log(res.join('\n')); console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
