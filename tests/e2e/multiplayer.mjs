import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Needs the dev server running (npm run dev). Screenshots go to tests/e2e/output.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const res = []; const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const warnings = [];
async function player(name, character) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(([n, c]) => { localStorage.setItem('diesel-house.name', n); localStorage.setItem('diesel-house.character', c); localStorage.setItem('diesel-house.mic-ok', '1'); }, [name, String(character)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  page.on('console', (m) => m.type() === 'warning' && warnings.push(name + ': ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence);
  return { ctx, page };
}
process.on('uncaughtException', async (e) => { console.log(res.join('\n')); console.log('CRASH', e.message); await browser.close(); process.exit(1); });
const A = await player('Alice test', 16);
const B = await player('Bob test', 19);
const status = (p) => p.page.locator('#status').textContent();
const count = async (p) => Number((await status(p)).match(/(\d+) in the house/)?.[1] ?? NaN);
// Real people may be in the house too, so compare counts with each other rather than expecting exactly 2.
const ids = { A: await A.page.evaluate(() => window.__house.presence.id), B: await B.page.evaluate(() => window.__house.presence.id) };
const sees = (p, id) => p.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, id, { timeout: 15000 }).then(() => true, () => false);
const seeEachOther = (await sees(A, ids.B)) && (await sees(B, ids.A));
const counts = [await count(A), await count(B)];
check('A and B see each other and agree on the head count', { counts, seeEachOther }, seeEachOther && counts[0] === counts[1] && counts[0] >= 2);

const aId = await A.page.evaluate(() => window.__house.presence.id);
const remoteA = () => B.page.evaluate((id) => { const r = window.__house.remotes.get(id); return r && { x: +r.avatar.sprite.x.toFixed(1), y: +r.avatar.sprite.y.toFixed(1), visible: r.avatar.sprite.visible, anim: r.avatar.sprite.anims.currentAnim?.key, name: r.info.name, zone: r.info.zone, character: r.info.character }; }, aId);
const aPos = () => A.page.evaluate(() => ({ x: Math.round(window.__house.player.x), y: Math.round(window.__house.player.y) }));
const tj = Date.now(); let r; while (Date.now() - tj < 20000) { r = await remoteA(); if (r?.visible) break; await B.page.waitForTimeout(100); }
res.push(`info  B first saw A after ${Date.now() - tj} ms (after both channels said 2)`);
check('B sees A at the spawn with name tag "Alice test"', r, r?.visible && r.name === 'Alice test' && r.x === 48 && r.y === 288);

// A walks right for 2s while B samples A's position every frame
const samples = [];
await A.page.keyboard.down('ArrowRight');
const t0 = Date.now();
while (Date.now() - t0 < 2000) { const s = await remoteA(); samples.push({ t: Date.now(), ...s }); await B.page.waitForTimeout(16); }
await A.page.keyboard.up('ArrowRight');
const walking = samples.filter((s) => s.anim === 'char16-walk-right').length;
check('B sees A walking right (walk animation)', { walkingSamples: walking, of: samples.length }, walking > samples.length / 2);
let jumps = 0; for (let i = 1; i < samples.length; i++) if (samples[i].x - samples[i - 1].x > 8) jumps++;
const back = samples.filter((s, i) => i && s.x < samples[i - 1].x - 0.5).length;
check('movement on B is smooth (no big jumps, never goes backwards)', { bigJumps: jumps, backwards: back, samples: samples.length }, jumps === 0 && back === 0);
await B.page.waitForTimeout(700);
const ap = await aPos(); r = await remoteA();
check('after A stops, B shows A at the same spot, idle', { A: ap, onB: r }, Math.abs(r.x - ap.x) <= 1 && Math.abs(r.y - ap.y) <= 1 && r.anim === 'char16-idle-right');

// Latency: time from A starting to move to B seeing it move
await B.page.waitForTimeout(300);
const startX = (await remoteA()).x; const t1 = Date.now();
await A.page.keyboard.down('ArrowLeft');
let lag = null; while (Date.now() - t1 < 3000) { if ((await remoteA()).x < startX - 0.5) { lag = Date.now() - t1; break; } await B.page.waitForTimeout(10); }
await A.page.keyboard.up('ArrowLeft');
check('B sees A start moving quickly', { ms: lag }, lag !== null && lag < 1000);

// Zone tracking: A walks into room 1
await A.page.evaluate(() => window.__house.body.reset(96, 250));
await A.page.keyboard.down('ArrowUp');
await A.page.waitForFunction(() => window.__house.zone === 'room_01');
const tz = Date.now(); let zoneLag = null;
while (Date.now() - tz < 5000) { if ((await remoteA()).zone === 'room_01') { zoneLag = Date.now() - tz; break; } await B.page.waitForTimeout(10); }
check('B learns A entered room 1 within 1 second', { ms: zoneLag }, zoneLag !== null && zoneLag < 1000);
await A.page.waitForTimeout(2000); await A.page.keyboard.up('ArrowUp');
await B.page.waitForTimeout(800);
r = await remoteA(); const az = await A.page.evaluate(() => window.__house.zone);
check('zone tracked: B knows A is in room_01', { aZone: az, seenByB: r.zone, onB: r }, az === 'room_01' && r.zone === 'room_01' && r.y < 90);
await B.page.evaluate((id) => { const s = window.__house.remotes.get(id).avatar.sprite; window.__house.body.reset(s.x, s.y + 70); }, aId);
await B.page.waitForTimeout(400);
await B.page.screenshot({ path: `${out}/p3_b_view.png` });

// Change character + name on A
await A.page.click('#xp-chip');
await A.page.fill('#player-name', 'Alice renamed');
await A.page.click('button[data-character="17"]');
await A.page.click('#picker-done');
const tn = Date.now(); while (Date.now() - tn < 8000) { r = await remoteA(); if (r.name === 'Alice renamed' && r.character === 17) break; await B.page.waitForTimeout(100); }
r = { ...(await remoteA()), ms: Date.now() - tn };
check('A changes name/character, B sees it', r, r.name === 'Alice renamed' && r.character === 17 && r.zone === 'room_01');

// A leaves
// Look for A specifically: real visitors may come and go at the same time, so the head count alone can mislead.
await A.ctx.close();
const tl = Date.now();
await B.page.waitForFunction((id) => !window.__house.remotes.get(id), ids.A, { timeout: 20000 }).catch(() => {});
r = await remoteA();
check('A closes the tab -> B sees them leave', { remote: r ?? null, ms: Date.now() - tl }, !r);
console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
if (warnings.length) console.log('warnings (not failures):\n' + [...new Set(warnings)].join('\n'));
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
