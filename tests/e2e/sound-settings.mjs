import { chromium } from 'playwright-core';
// Settings → Sound and Mic: each slider changes only its category (and Voices changes friends' volume),
// settings survive a reload, the input meter moves, and the mic test records and plays back. Dev test mode.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript((n) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', '16');
    localStorage.setItem('diesel-house.mic-ok', '1');
  }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { name, ctx, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const setSlider = (p, id, v) => p.page.$eval(`#${id}`, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const levels = (p) => p.page.evaluate(async () => {
  const { mixer } = await import('/src/ui/mixer.ts');
  return { game: mixer.bus('game').gain.value, music: mixer.bus('music').gain.value, ...mixer.levels };
});

const A = await player('Alice snd');
const B = await player('Bob snd');
for (const p of [A, B]) await p.page.evaluate(() => { window.__house.body.reset(272, 120); window.__house.sendMove(true); });
await A.page.waitForFunction((id) => window.__house.voice.debug().some((d) => d.id === id && d.state === 'connected'), B.id, { timeout: 20000 });
await A.page.waitForSelector('audio[data-peer]', { state: 'attached', timeout: 10000 });

// Sound tab opens first.
await A.page.click('#settings-button');
await A.page.waitForSelector('#vol-master');
const tabs = await A.page.$$eval('[id^=settings-tab-]', (bs) => bs.map((b) => b.id.replace('settings-tab-', '')));

// Each slider changes only its own category.
const before = await levels(A);
await setSlider(A, 'vol-music', 0);
const afterMusic = await levels(A);
await setSlider(A, 'vol-game', 25);
const afterGame = await levels(A);
check('Sound tab: Game sounds and Music sliders each change only their own sound', { tabs, before: [before.game, before.music], afterMusic: [afterMusic.game, afterMusic.music], afterGame: [afterGame.game, afterGame.music] },
  tabs[0] === 'sound' && afterMusic.music === 0 && afterMusic.game === before.game && afterGame.game === 0.25 && afterGame.music === 0);

// Voices: a friend's voice volume follows the Voices slider (master × voices × theirs).
const vol = () => A.page.$eval('audio[data-peer]', (a) => a.volume);
const v1 = await vol();
await setSlider(A, 'vol-voices', 50);
const v2 = await vol();
check('Voices slider changes how loud friends are', { v1, v2 }, Math.abs(v2 - v1 / 2) < 0.02);

// Switches, and they survive a reload.
await A.page.click('label[for=sfx-chimes]');
await A.page.click('#settings-close');
await A.page.reload();
await A.page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
const kept = await levels(A);
check('settings are saved on this device (survive a reload)', { game: kept.game, music: kept.music, voices: kept.voices, chimes: kept.chimes }, kept.game === 0.25 && kept.music === 0 && kept.voices === 0.5 && kept.chimes === false);

// Mic tab: the meter moves (the test mic plays a tone), and the mic test records then plays back.
await A.page.evaluate(() => { window.__house.body.reset(272, 120); window.__house.sendMove(true); });
await A.page.waitForFunction(() => !!window.__house.voice.micStream, null, { timeout: 15000 });
await A.page.click('#settings-button');
await A.page.click('#settings-tab-mic');
await A.page.waitForSelector('#mic-meter');
const moving = await A.page.waitForFunction(() => Number(document.getElementById('mic-meter')?.dataset.level ?? 0) > 0, null, { timeout: 5000 }).then(() => true, () => false);
await A.page.click('#mic-test');
const recording = await A.page.waitForFunction(() => /Recording/.test(document.getElementById('mic-test')?.textContent ?? ''), null, { timeout: 2000 }).then(() => true, () => false);
const playing = await A.page.waitForFunction(() => /Playing it back/.test(document.getElementById('mic-test')?.textContent ?? ''), null, { timeout: 6000 }).then(() => true, () => false);
const done = await A.page.waitForFunction(() => /Test: record/.test(document.getElementById('mic-test')?.textContent ?? ''), null, { timeout: 8000 }).then(() => true, () => false);
check('Mic tab: the input meter moves; the mic test records 3 s and plays it back', { moving, recording, playing, done }, moving && recording && playing && done);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
