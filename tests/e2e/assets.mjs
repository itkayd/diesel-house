import { chromium } from 'playwright-core';
// UPDATE.md Phase 9: the new art and sounds load with no 404s, their frames exist, the walkie sounds
// (made in code) play through the radio bus, and Credits lists the new packs. Dev test mode.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const missing = [];
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Assets');
  localStorage.setItem('diesel-house.character', '16');
  window.__osc = 0;
  const orig = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) {
    window.__osc++;
    return orig.apply(this, a);
  };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => r.status() >= 400 && missing.push(`${r.status()} ${r.url()}`));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
await page.mouse.click(200, 200); // unlock sound

const tex = await page.evaluate(() => {
  const t = window.__house.textures;
  const has = (key, frame) => t.exists(key) && t.get(key).has(frame);
  return {
    cards: ['spades_A', 'hearts_K', 'back', 'joker_red', 'die_1', 'die_6', 'die_q'].every((f) => has('cards', f)),
    cardCount: t.get('cards').getFrameNames().filter((f) => /^(hearts|diamonds|clubs|spades)_/.test(f)).length,
    emotes: ['heart', 'laugh', 'question', 'exclamation', 'sleep', 'dots3'].every((f) => has('emotes', f)),
    prompts: ['key_e', 'key_t', 'key_q', 'key_space', 'tap', 'mic'].every((f) => has('prompts', f)),
    uiTiles: t.exists('ui_pack') ? t.get('ui_pack').frameTotal - 1 : 0,
  };
});
check('new sheets load with no missing files: 52 cards + backs + 7 dice, emotes, prompts, UI tiles', { ...tex, missing },
  tex.cards && tex.cardCount === 52 && tex.emotes && tex.prompts && tex.uiTiles === 161 && missing.length === 0);

const sounds = await page.evaluate(async () => (await import('/src/ui/sounds.ts')).soundsFound());
const casino = ['dice_shake', 'dice_throw', 'card_place', 'card_flip', 'card_shuffle', 'chips'];
check('the casino sounds are there (23 sounds in all)', { count: sounds.length, casino: casino.every((n) => sounds.includes(n)) }, sounds.length === 23 && casino.every((n) => sounds.includes(n)));

const radio = await page.evaluate(async () => {
  const [{ squelch, busyBuzz }, { mixer }] = await Promise.all([import('/src/ui/radioSfx.ts'), import('/src/ui/mixer.ts')]);
  window.__osc = 0;
  squelch(true);
  squelch(false);
  busyBuzz();
  const played = window.__osc;
  mixer.set('radio', 0.4);
  const gain = mixer.bus('radio').gain.value;
  mixer.set('radio', 0.9);
  return { played, gain };
});
check('walkie sounds made in code play, through the radio volume', radio, radio.played === 4 && Math.abs(radio.gain - 0.4) < 1e-6);

// (Settings → More → Credits for signed-in players; test mode has no account, so open it directly.)
await page.evaluate(async () => (await import('/src/ui/credits.ts')).openCredits());
await page.waitForSelector('#credits li');
const credits = await page.$$eval('#credits li', (ls) => ls.map((l) => l.textContent));
const want = ['Emotes', 'Playing Cards', 'UI Pack Pixel Adventure', 'Input Prompts', 'Casino Audio', 'Juhani Junkala'];
check('Credits lists the new packs', { found: want.filter((w) => credits.some((c) => c.includes(w))) }, want.every((w) => credits.some((c) => c.includes(w))));

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
