import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Needs the dev server running (npm run dev). Screenshots go to tests/e2e/output.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = []; const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1')); // mic card is tested in audio.mjs
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of 503/.test(m.text()) && errors.push(m.text())); // 503: /api/turn with no Twilio keys on this computer
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => window.__house?.player);
const st = () => page.evaluate(() => { const h = window.__house; return { x: Math.round(h.player.x), y: Math.round(h.player.y), zone: h.zone, anim: h.player.anims.currentAnim?.key, frame: h.player.frame.name, tex: h.player.texture.key }; });
const hold = async (key, ms = 2500) => { await page.keyboard.down(key); await page.waitForTimeout(ms); const during = await st(); await page.keyboard.up(key); await page.waitForTimeout(150); return { during, after: await st() }; };
const tp = (x, y) => page.evaluate(([x, y]) => window.__house.body.reset(x, y), [x, y]);

// First launch: the wardrobe (R4 + S2c): only what you can wear, the 12 free starters; the Shop sells the rest.
const n = await page.locator('button[data-character]').count();
const free = await page.$$eval('button[data-character]', (bs) => bs.filter((b) => /Free/.test(b.textContent)).length);
const firstVisit = await page.evaluate(() => ({ title: document.getElementById('picker-title')?.textContent, shop: !!document.getElementById('picker-shop'), filters: document.querySelector('.dh-pick-filters')?.hidden }));
check('first launch: “Who are you?” with the 12 free starters, no Shop card or search yet', { n, free, firstVisit }, n === 12 && free === 12 && firstVisit.title === 'Who are you?' && !firstVisit.shop && firstVisit.filters);
let a = await st(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight'); let b = await st();
check('cannot walk while picker is open', b, a.x === b.x);
// Portraits drawn (non-blank) — checked numerically
const blank = await page.evaluate(() => [...document.querySelectorAll('button[data-character] canvas')].filter((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }).length);
check('every portrait has a picture', blank, blank === 0);
// Preview a starter, save it as a favourite
await page.click('button[data-character="ninja.oldman"]');
const prev = await page.evaluate(() => ({ name: document.getElementById('picker-selected')?.textContent, tag: document.querySelector('.dh-pick-preview .dh-rarity')?.textContent, knight: !!document.querySelector('button[data-character="ninja.knight"]') }));
await page.click('#picker-fav');
const starred = await page.$$eval('button[data-character] .fv', (fs) => fs.map((f) => f.closest('button').dataset.character));
check('a starter previews as Free and can be saved; shop characters aren’t in the wardrobe', { prev, starred }, prev.name === 'Old Man' && prev.tag === 'Free' && !prev.knight && JSON.stringify(starred) === '["ninja.oldman"]');

// Picking without a name is refused
await page.click('button[data-character="ninja.villager2"]');
await page.click('#picker-done');
check('picker refuses to continue without a name', { error: await page.locator('#picker-error').textContent() }, (await page.locator('button[data-character]').count()) === 12);
await page.fill('#player-name', 'Tester');
await page.click('button[data-character="ninja.villager2"]');
await page.click('#picker-done');
b = await st(); const saved = await page.evaluate(() => localStorage.getItem('diesel-house.character'));
check('picking closes picker and saves choice', { saved, picker: await page.locator('button[data-character]').count() }, saved === 'ninja.villager2');
const frameOf = (anim, dir, step) => page.evaluate(([anim, dir, step]) => import('/src/characters.ts').then((m) => m.skinFrame('ninja.villager2', anim, dir, step).frame), [anim, dir, step]);
check('idle faces down on the skins atlas', b, b.tex === 'skins' && b.anim === 'ninja.villager2-idle-down' && b.frame === (await frameOf('idle', 'down', 0)));
// Walk directions → animations + frames for that facing
for (const [key, dir] of [['ArrowRight', 'right'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowUp', 'up']]) {
  await tp(1040, 600); // the Disco's dance floor: open in every direction
  const frames = new Set();
  await page.keyboard.down(key);
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(110); frames.add((await st()).frame); } // (headless runs at ~20 fps)
  await page.keyboard.up(key); await page.waitForTimeout(150);
  const after = await st();
  const want = new Set([await frameOf('walk', dir, 0), await frameOf('walk', dir, 1), await frameOf('walk', dir, 2), await frameOf('walk', dir, 3)]);
  const okRow = [...frames].every((f) => want.has(f));
  check(`walking ${dir}: walk anim cycles the ${dir} frames, then idles facing ${dir}`, { frames: [...frames], after: after.anim }, okRow && frames.size >= 2 && after.anim === `ninja.villager2-idle-${dir}`);
}

// Collision with feet-based body (the octagon house, REDESIGN.md R3)
await tp(600, 520);
let r = await hold('ArrowUp'); check('hall wall blocks (feet stop below the wall face)', r.after, r.after.y === 454 && r.after.zone === 'hallway');
await tp(656, 500); r = await hold('ArrowUp', 3500); check('through the door into the garden, stops at the back hedge', r.after, r.after.zone === 'garden' && r.after.y === 230);
r = await hold('ArrowRight', 3000); check('a tree blocks on the way along the hedge (furniture blocks)', r.after, r.after.x === 729);
await tp(368, 900); r = await hold('ArrowDown', 2500); check('café (clear column), stops at the bottom wall', r.after, r.after.zone === 'cafe' && r.after.y === 1008);

// Reload: remembered, no picker
await page.reload(); await page.waitForFunction(() => window.__house?.player);
b = await st(); check('choice remembered after reload (no picker)', { n: await page.locator('button[data-character]').count(), anim: b.anim }, b.anim === 'ninja.villager2-idle-down');

// An old saved character number (before R4) becomes its starter
await page.evaluate(() => localStorage.setItem('diesel-house.character', '18'));
await page.reload(); await page.waitForFunction(() => window.__house?.player);
b = await st(); check('an old saved character number (18) becomes its starter (Woman)', b, b.anim === 'ninja.woman-idle-down');

// Change character: the wardrobe again, now with "More in the Shop"; try a shop one on for 60 s (only on this screen)
await page.click('#xp-chip');
await page.waitForSelector('#picker-shop');
const again = await page.evaluate(() => ({ n: document.querySelectorAll('button[data-character]').length, title: document.getElementById('picker-title')?.textContent, done: document.getElementById('picker-done')?.textContent }));
check('Change character reopens the wardrobe with a way to the Shop', again, again.n === 12 && again.title === 'Your character' && again.done === 'Done');
await page.click('#picker-shop');
await page.waitForSelector('#store-tab-characters[aria-selected="true"]');
await page.click('[data-item="ninja.samurai"]');
await page.click('#store-try');
await page.waitForTimeout(300);
r = await hold('ArrowRight', 800);
const kept = await page.evaluate(() => ({ mine: window.__house.character, saved: localStorage.getItem('diesel-house.character'), open: !!document.getElementById('store') }));
check('Shop → Try on: the shop character walks around, but your own stays saved', { anim: r.during.anim, kept }, r.during.anim === 'ninja.samurai-walk-right' && !kept.open && kept.mine === 'ninja.woman' && kept.saved === 'ninja.woman'); // (the old number was saved back as a key)
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/r4_try_on.png` });
console.log(res.join('\n')); console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
