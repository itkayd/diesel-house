import { chromium } from 'playwright-core';
// Sound unlocking and the mic explainer (NEXT.md 3.2). Needs `npm run dev`.
// Headless Edge plays sound without a tap whatever the flags, so each page gets a small stand-in for the
// iPhone rule (IPHONE_AUDIO_RULES): audio starts suspended, resumes only during a real tap/key press, and
// <audio> refuses to play before the first one. This checks our unlock logic; a real iPhone is still the final test.
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
// (Playwright runs page.evaluate as a "user gesture", so we track real input events ourselves.)
const IPHONE_AUDIO_RULES = () => {
  let tapping = false;
  let tappedOnce = false;
  for (const e of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup'])
    window.addEventListener(e, (ev) => {
      if (!ev.isTrusted) return;
      tapping = tappedOnce = true;
      setTimeout(() => (tapping = false), 0);
    }, true);
  const Real = window.AudioContext;
  const resume = Real.prototype.resume;
  Real.prototype.resume = function () {
    return tapping ? resume.call(this) : Promise.resolve();
  };
  window.AudioContext = function (...a) {
    const c = new Real(...a);
    void c.suspend();
    return c;
  };
  window.AudioContext.prototype = Real.prototype;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    return tappedOnce ? play.call(this) : Promise.reject(new DOMException('needs a tap', 'NotAllowedError'));
  };
};
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});

async function player(name, character, { micGranted = false, micSeen = false, micBlocked = false, phone = false } = {}) {
  const ctx = await browser.newContext({
    ...(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 900, height: 650 } }),
    permissions: micGranted ? ['microphone'] : [],
  });
  await ctx.addInitScript(([n, c, seen, blocked]) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', c);
    if (seen) localStorage.setItem('diesel-house.mic-ok', '1');
    if (blocked) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  }, [name, String(character), micSeen, micBlocked]);
  await ctx.addInitScript(IPHONE_AUDIO_RULES);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { name, ctx, page };
}
// Teleport (no gesture), as opposed to walking with keys or the joystick (gestures).
const tp = (p, x, y) => p.page.evaluate(([x, y]) => window.__house.body.reset(x, y), [x, y]);
const visible = (p, sel) => p.page.locator(sel).isVisible().catch(() => false);
const ctxState = (p) => p.page.evaluate(() => window.__house.voice.ctx?.state ?? 'none');
const voiceState = (p) => p.page.evaluate(() => ({ room: window.__house.voice.room, hasMic: !!window.__house.voice.stream, peers: window.__house.voice.debug().map((d) => d.state) }));
const ROOM3 = [448, 120], HALL = [448, 256];

// 1. First time in a room, mic not yet allowed: the explainer shows before any browser prompt.
const A = await player('Asker', 16);
await tp(A, ...ROOM3);
await A.page.waitForSelector('#mic-prompt', { timeout: 5000 }).catch(() => {});
check('first room entry shows the mic explainer', { card: await visible(A, '#mic-prompt'), voice: await voiceState(A) }, (await visible(A, '#mic-prompt')) && !(await voiceState(A)).hasMic);
await tp(A, ...HALL);
await A.page.waitForTimeout(500);
check('walking out before answering closes the explainer', { card: await visible(A, '#mic-prompt') }, !(await visible(A, '#mic-prompt')));
await tp(A, ...ROOM3);
await A.page.waitForSelector('#mic-prompt');
await A.page.click('#mic-prompt-yes');
await A.page.waitForFunction(() => !!window.__house.voice.stream, null, { timeout: 5000 }).catch(() => {});
check('"Turn on mic" uses the mic, and that tap unlocks sound', { voice: await voiceState(A), audio: await ctxState(A), banner: await visible(A, '#sound-banner') }, (await voiceState(A)).hasMic && (await ctxState(A)) === 'running' && !(await visible(A, '#sound-banner')));
const remembered = await A.page.evaluate(() => localStorage.getItem('diesel-house.mic-ok'));
check('the answer is remembered', { remembered }, remembered === '1');

// 2. "Just listen" joins without the mic.
const L = await player('Listener', 17);
await tp(L, ...ROOM3);
await L.page.waitForSelector('#mic-prompt');
await L.page.click('#mic-prompt-no');
await L.page.waitForFunction(() => window.__house.voice.debug().some((d) => d.state === 'connected'), null, { timeout: 20000 }).catch(() => {});
check('"Just listen" joins without the mic and still connects', await voiceState(L), !(await voiceState(L)).hasMic && (await voiceState(L)).peers.includes('connected'));

// 3. No gesture at all (teleported in) and no live mic: sound is locked, so the banner asks for a tap.
// (Chromium lets a page that is using the mic play sound without a tap; iPhones do not, hence the blocked mic here.)
const T = await player('Teleported', 18, { micSeen: true, micBlocked: true });
await tp(T, ...ROOM3);
await T.page.waitForSelector('#sound-banner', { timeout: 8000 }).catch(() => {});
check('no tap yet: "Tap to turn on sound" banner shows, sound locked', { banner: await visible(T, '#sound-banner'), audio: await ctxState(T) }, (await visible(T, '#sound-banner')) && (await ctxState(T)) !== 'running');
await T.page.click('#sound-banner');
await T.page.waitForTimeout(500);
check('tapping the banner turns sound on and hides it', { banner: await visible(T, '#sound-banner'), audio: await ctxState(T) }, !(await visible(T, '#sound-banner')) && (await ctxState(T)) === 'running');

// 4. Phone player who only ever touched the joystick: walking in still plays other people's voices.
const P = await player('Thumb', 19, { micGranted: true, micSeen: true, phone: true });
const cdp = await P.ctx.newCDPSession(P.page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const joy = await P.page.evaluate(() => {
  const r = document.getElementById('joystick').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await tp(P, 448, 250); // just outside room 3's door
await touch('touchStart', joy.x, joy.y);
await touch('touchMove', joy.x, joy.y - 60);
await P.page.waitForTimeout(2500);
await touch('touchEnd');
await P.page.waitForFunction(() => window.__house.voice.debug().filter((d) => d.state === 'connected').length >= 2, null, { timeout: 20000 }).catch(() => {});
await P.page.waitForTimeout(1500);
const heard = await P.page.evaluate(async () => {
  const out = [];
  for (const d of window.__house.voice.debug()) {
    let level = 0;
    (await d.pc.getStats()).forEach((s) => s.type === 'inbound-rtp' && s.kind === 'audio' && (level = s.audioLevel ?? 0));
    const el = document.querySelector(`audio[data-peer="${d.id}"]`);
    out.push({ state: d.state, level: +level.toFixed(2), playing: !!el && !el.paused });
  }
  return { zone: window.__house.zone, audio: window.__house.voice.ctx?.state, peers: out };
});
check('joystick-only phone player: sound on, voices playing, no banner', { ...heard, banner: await visible(P, '#sound-banner') },
  heard.zone === 'room_03' && heard.audio === 'running' && heard.peers.length >= 2 && heard.peers.some((p) => p.playing && p.level > 0) && !(await visible(P, '#sound-banner')));

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
