import { chromium } from 'playwright-core';
// The sound packs (FIXES.md 7): every sound loads (no 404s), decodes and plays through the mixer; the
// Sound switches silence their group; footsteps tick while walking. Dev test mode.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const missing = [];
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Ears');
  localStorage.setItem('diesel-house.character', '16');
  // Count sounds actually started (each play() starts one buffer source).
  window.__started = [];
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__started.push(this.buffer?.duration ?? 0);
    return orig.apply(this, a);
  };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => r.status() >= 400 && missing.push(`${r.status()} ${r.url()}`));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
await page.mouse.click(200, 200); // a tap unlocks sound

const found = await page.evaluate(async () => {
  const s = await import('/src/ui/sounds.ts');
  return s.soundsFound();
});
const ALL = ['knock', 'doorbell', 'door_open', 'join', 'leave', 'footstep', 'footstep2', 'click', 'confirm', 'error', 'coin', 'powerup', 'emote', 'levelup', 'challenge', 'win', 'lose'];
check('all 17 sounds are found, with no missing files', { found: found.length, missing }, ALL.every((n) => found.includes(n)) && missing.length === 0);

const played = await page.evaluate(async (all) => {
  const s = await import('/src/ui/sounds.ts');
  window.__started = [];
  for (const n of all) s.play(n);
  await new Promise((r) => setTimeout(r, 2500));
  return window.__started.filter((d) => d > 0).length;
}, ALL);
check('every sound decodes and plays', { played }, played === ALL.length);

const doors = await page.evaluate(async () => {
  const [{ mixer }, s] = await Promise.all([import('/src/ui/mixer.ts'), import('/src/ui/sounds.ts')]);
  mixer.set('doors', false);
  window.__started = [];
  s.play('knock');
  s.play('click');
  await new Promise((r) => setTimeout(r, 600));
  const n = window.__started.length;
  mixer.set('doors', true);
  return n;
});
check('"Door and knock sounds" off: the knock is silent, other sounds still play', { started: doors }, doors === 1);

await page.evaluate(() => (window.__started = []));
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(1500);
await page.keyboard.up('ArrowRight');
const steps = await page.evaluate(() => window.__started.length);
check('footsteps tick quietly while you walk', { steps }, steps >= 3 && steps <= 6);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
