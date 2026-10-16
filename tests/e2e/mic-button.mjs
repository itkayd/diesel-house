import { chromium } from 'playwright-core';
// The mic button always says what's going on (caption under it): Mic on / Muted / Mic blocked / No mic
// found / Mic busy / Mic silent; tapping a problem helps fix it; phones start with an open mic, not
// push-to-talk. Runs in dev test mode.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});
// `mic`: what getUserMedia does on this phone.
async function phone(name, mic) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: mic === 'denied' ? [] : ['microphone'] });
  await ctx.addInitScript(([n, mic]) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', '16');
    localStorage.setItem('diesel-house.mic-ok', '1');
    const err = { none: 'NotFoundError', busy: 'NotReadableError' }[mic];
    if (err) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('x', err));
    if (mic === 'silent') navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  }, [name, mic]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto('http://localhost:5173/?test&silentms=3000');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  await page.evaluate(() => { window.__house.body.reset(272, 120); window.__house.sendMove(true); });
  await page.waitForSelector('#mic-caption', { state: 'visible', timeout: 15000 });
  return { ctx, page };
}
const caption = (p, want, ms = 15000) =>
  p.page.waitForFunction((want) => document.getElementById('mic-caption')?.textContent === want, want, { timeout: ms }).then(() => want, () => p.page.evaluate(() => document.getElementById('mic-caption')?.textContent));

const ok = await phone('Mic fine', 'ok');
const startsOpen = await ok.page.evaluate(() => ({ ptt: window.__house.voiceControls.pushToTalk }));
const on = await caption(ok, 'Mic on');
await ok.page.click('#mic-button');
const muted = await caption(ok, 'Muted');
await ok.page.click('#mic-button');
const again = await caption(ok, 'Mic on');
check('phone starts with an open mic (no push-to-talk): "Mic on", tap "Muted", tap "Mic on"', { ...startsOpen, on, muted, again }, !startsOpen.ptt && on === 'Mic on' && muted === 'Muted' && again === 'Mic on');

const denied = await phone('Mic denied', 'denied');
const blocked = await caption(denied, 'Mic blocked');
await denied.page.click('#mic-button');
const sheet = await denied.page.waitForSelector('#mic-help', { timeout: 5000 }).then(() => true, () => false);
await denied.ctx.grantPermissions(['microphone'], { origin: 'http://localhost:5173' });
await denied.page.click('#mic-help-retry');
const fixed = await caption(denied, 'Mic on');
check('mic blocked: "Mic blocked", tap opens the help, allow + Try again: "Mic on" (no reload)', { blocked, sheet, fixed }, blocked === 'Mic blocked' && sheet && fixed === 'Mic on');

const none = await phone('No mic', 'none');
const busy = await phone('Busy mic', 'busy');
const results = { none: await caption(none, 'No mic found'), busy: await caption(busy, 'Mic busy') };
check('no microphone: "No mic found"; another app using it: "Mic busy"', results, results.none === 'No mic found' && results.busy === 'Mic busy');

const silent = await phone('Silent mic', 'silent');
const s = await caption(silent, 'Mic silent', 20000);
const toast = await silent.page.locator('#mic-silent-toast').count();
check('mic only gives silence: tried again by itself, then "Mic silent" and a message', { s, toast }, s === 'Mic silent' && toast === 1);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
