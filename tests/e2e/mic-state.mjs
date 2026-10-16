import { chromium } from 'playwright-core';
// Others can see why they can't hear you: a red crossed mic on your tag when you're muted or have no mic,
// an amber one plus "mic not working" when your mic only gives silence (another app holding it, which is
// reopened once, then reported to you). Needs `npm run dev`; runs in dev test mode (its own house,
// separate from real players).
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
async function player(name, init) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript((n) => {
    localStorage.setItem('diesel-house.mic-ok', '1');
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', '16');
  }, name);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const look = (viewer, id) => viewer.page.evaluate((id) => {
  const a = window.__house.remotes.get(id)?.avatar;
  return a ? { mic: a.mic, tag: a.tagText.text } : null;
}, id);
const waitFor = (viewer, id, test, ms = 15000) =>
  viewer.page.waitForFunction(([id, src]) => {
    const a = window.__house.remotes.get(id)?.avatar;
    return !!a && new Function('a', `return ${src}`)(a);
  }, [id, test], { timeout: ms }).catch(() => {});

// A's mic only ever gives exact silence (like an Android mic another app is holding).
const silentMic = () => {
  navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
};
const A = await player('Alice mic', silentMic);
const B = await player('Bob mic');
await tp(A, 272, 120);
await tp(B, 272, 120);
await B.page.waitForFunction((id) => window.__house.voice.debug().some((d) => d.id === id && d.state === 'connected'), A.id, { timeout: 20000 });

// 1. Muted: red crossed mic, green again on unmute.
await A.page.click('#mic-button');
await waitFor(B, A.id, "a.mic === 'off'");
const muted = await look(B, A.id);
await A.page.click('#mic-button');
await waitFor(B, A.id, "a.mic === 'on'");
const unmuted = await look(B, A.id);
check("A mutes: B sees the red muted mic on A's tag, green again when A unmutes", { muted, unmuted }, muted?.mic === 'off' && unmuted?.mic === 'on');

// 2. Silent mic: reopened once, then reported to A; B sees the amber mic and "mic not working".
const toast = await A.page.waitForSelector('#mic-silent-toast', { timeout: 35000 }).then(() => true, () => false);
await waitFor(B, A.id, "a.mic === 'warn'", 8000);
const silent = await look(B, A.id);
check('A\'s mic gives only silence: A is told, B sees "mic not working"', { toast, silent }, toast && silent?.mic === 'warn' && /mic not working/.test(silent?.tag ?? ''));

// 3. No mic (the browser refuses it): red crossed mic.
await A.page.evaluate(() => (navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refused', 'NotAllowedError'))));
await tp(A, 300, 256);
await A.page.waitForTimeout(1200);
await tp(A, 272, 120);
await waitFor(B, A.id, "a.mic === 'off'");
const off = await look(B, A.id);
check("A has no mic: B sees the red mic on A's tag", { off }, off?.mic === 'off');

// In the hallway there's no voice, so no mic icon or note.
await tp(A, 300, 256);
await waitFor(B, A.id, 'a.mic === null', 8000);
const hall = await look(B, A.id);
check('in the hallway the mic icon and note go away', { hall }, hall?.mic === null && hall?.tag === 'Alice mic');

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
