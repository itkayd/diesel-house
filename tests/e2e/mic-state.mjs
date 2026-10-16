import { chromium } from 'playwright-core';
// Others can see why they can't hear you: "muted", "mic off", "mic not working" on your name tag, and
// a silent mic (another app holding it) is reopened, then reported to you. Needs `npm run dev` and
//   DH_TEST_OWNER="Name:password"   DH_TEST_VISITOR="Name:password"
const A_ = process.env.DH_TEST_OWNER?.split(':');
const B_ = process.env.DH_TEST_VISITOR?.split(':');
if (!A_ || !B_) {
  console.log('SKIP  mic-state: set DH_TEST_OWNER and DH_TEST_VISITOR to run');
  process.exit(0);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
async function signIn([name, password], init) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1'));
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#si-name');
  await page.fill('#si-name', name);
  await page.fill('#si-pass', password);
  await page.click('#signin .knock');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const tagOf = (viewer, id) => viewer.page.evaluate((id) => window.__house.remotes.get(id)?.avatar.tagText.text ?? null, id);
const waitTag = (viewer, id, re, ms = 15000) =>
  viewer.page.waitForFunction(([id, re]) => new RegExp(re).test(window.__house.remotes.get(id)?.avatar.tagText.text ?? ''), [id, re], { timeout: ms }).catch(() => {});

// A's mic only ever gives exact silence (like an Android mic another app is holding).
const silentMic = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    return ctx.createMediaStreamDestination().stream;
  };
};
const A = await signIn(A_, silentMic);
const B = await signIn(B_);
await tp(A, 272, 120);
await tp(B, 272, 120);
await B.page.waitForFunction((id) => window.__house.voice.debug().some((d) => d.id === id && d.state === 'connected'), A.id, { timeout: 20000 });

// 1. Muted.
await A.page.click('#mic-button');
await waitTag(B, A.id, 'muted');
const muted = await tagOf(B, A.id);
await A.page.click('#mic-button');
await waitTag(B, A.id, `^${A_[0]}$`, 8000);
const unmuted = await tagOf(B, A.id);
check('A mutes: B sees "muted" on A\'s tag, and it goes when A unmutes', { muted, unmuted }, /· muted$/.test(muted ?? '') && unmuted === A_[0]);

// 2. Silent mic: reopened once, then reported to A, and B sees "mic not working".
const toast = await A.page.waitForSelector('#mic-silent-toast', { timeout: 35000 }).then(() => true, () => false);
await waitTag(B, A.id, 'mic not working', 8000);
const silentTag = await tagOf(B, A.id);
check('A\'s mic gives only silence: A is told, B sees "mic not working"', { toast, silentTag }, toast && /mic not working/.test(silentTag ?? ''));

// 3. No mic (the browser refuses it): B sees "mic off".
await A.page.evaluate(() => (navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refused', 'NotAllowedError'))));
await tp(A, 300, 256);
await A.page.waitForTimeout(1200);
await tp(A, 272, 120);
await waitTag(B, A.id, 'mic off');
const off = await tagOf(B, A.id);
check("A has no mic: B sees \"mic off\" on A's tag", { off }, /· mic off$/.test(off ?? ''));

// In the hallway nobody's tag says anything about mics.
await tp(A, 300, 256);
await waitTag(B, A.id, `^${A_[0]}$`, 8000);
check('in the hallway the mic note goes away', { tag: await tagOf(B, A.id) }, (await tagOf(B, A.id)) === A_[0]);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
