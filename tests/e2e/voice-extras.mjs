import { chromium } from 'playwright-core';
// Voice tweaks (NEXT.md 3.3): Opus settings, per-person volume, mic picker, surviving a dropped
// Supabase connection. Needs `npm run dev`. Uses Edge's fake microphones (a test tone).
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});

async function player(name, character) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 650 }, permissions: ['microphone'] });
  await ctx.addInitScript(([n, c]) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', c);
    localStorage.setItem('diesel-house.mic-ok', '1');
    // Keep hold of Supabase's sockets so the test can cut them, like a flaky phone connection.
    const WS = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = class extends WS {
      constructor(...a) {
        super(...a);
        if (String(a[0]).includes('supabase')) window.__sockets.push(this);
      }
    };
  }, [name, String(character)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { name, ctx, page, id: await page.evaluate(() => window.__house.presence.id) };
}
// Teleport (test only) and tell everyone, as a real move would.
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const ROOM4 = [624, 120], HALL = [624, 256];
const connectedTo = (p, other) =>
  p.page.waitForFunction((id) => window.__house.voice.debug().some((d) => d.id === id && d.state === 'connected'), other.id, { timeout: 20000 }).then(() => true, () => false);
// Loudest incoming level over ~2 s. (DTX sends nothing in the gaps between the fake mic's beeps, so a
// single reading can be 0 even though the call is fine.)
const hearing = (p, other) =>
  p.page.evaluate(async (id) => {
    let max = 0;
    for (let i = 0; i < 20; i++) {
      const d = window.__house.voice.debug().find((x) => x.id === id);
      if (!d) return null;
      (await d.pc.getStats()).forEach((s) => s.type === 'inbound-rtp' && s.kind === 'audio' && (max = Math.max(max, s.audioLevel ?? 0)));
      await new Promise((r) => setTimeout(r, 100));
    }
    return +max.toFixed(2);
  }, other.id);

const A = await player('Ann test', 16);
const B = await player('Ben test', 17);
await tp(A, ...ROOM4);
await tp(B, ...ROOM4);
const linked = (await connectedTo(A, B)) && (await connectedTo(B, A));
check('A and B connect in room 4', { linked }, linked);
await A.page.waitForTimeout(1500);

// 1. Opus settings are in both sides' descriptions.
const fmtp = await A.page.evaluate((id) => {
  const pc = window.__house.voice.debug().find((d) => d.id === id).pc;
  const opus = (sdp) => {
    const pt = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
    return sdp.match(new RegExp(`a=fmtp:${pt} (.*)`))?.[1]?.trim();
  };
  return { local: opus(pc.localDescription.sdp), remote: opus(pc.remoteDescription.sdp) };
}, B.id);
const wanted = ['useinbandfec=1', 'usedtx=1', 'maxaveragebitrate=32000', 'stereo=0'];
check('Opus asks for FEC, DTX, 32 kbps, mono (both directions)', fmtp, wanted.every((w) => fmtp.local?.includes(w) && fmtp.remote?.includes(w)));

// 2. Per-person volume: B taps A's character, turns A down to 30%. (Wait until B can see A to tap them.)
await B.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 15000 });
const bStart = await B.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
const spot = await B.page.evaluate((id) => {
  const h = window.__house;
  const s = h.remotes.get(id).avatar.sprite;
  const cam = h.cameras.main;
  const canvas = h.game.canvas.getBoundingClientRect();
  return { x: canvas.left + (s.x - cam.worldView.x) * cam.zoom, y: canvas.top + (s.y - 12 - cam.worldView.y) * cam.zoom };
}, A.id);
await B.page.mouse.click(spot.x, spot.y);
await B.page.waitForSelector('#friend-menu', { timeout: 3000 }).catch(() => {});
check('tapping a character in your room opens their volume slider', { open: await B.page.locator('#friend-menu').isVisible().catch(() => false) }, await B.page.locator('#friend-menu').isVisible().catch(() => false));
await B.page.locator('#volume-slider').fill('30');
// Played at that friend's volume × the Master and Voices sliders (src/ui/mixer.ts).
const playedAt = (id) => B.page.evaluate(async (id) => {
  const { mixer } = await import('/src/ui/mixer.ts');
  const a = document.querySelector(`audio[data-peer="${id}"]`);
  return a ? a.volume / (mixer.levels.master * mixer.levels.voices) : null;
}, id);
const vol = await playedAt(A.id);
const bAfter = await B.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
check('slider sets A to 30% on B, and the tap did not walk B anywhere', { volume: vol, moved: bAfter.x !== bStart.x || bAfter.y !== bStart.y }, Math.abs(vol - 0.3) < 0.001 && bAfter.x === bStart.x && bAfter.y === bStart.y);
await B.page.mouse.click(20, 600); // tap elsewhere closes it
await tp(B, ...HALL);
await B.page.waitForTimeout(800);
await tp(B, ...ROOM4);
await connectedTo(B, A);
await B.page.waitForTimeout(800);
const volAgain = await playedAt(A.id);
check('the volume is remembered next time', { volume: volAgain, popoverClosed: !(await B.page.locator('#friend-menu').count()) }, Math.abs(volAgain - 0.3) < 0.001);

// 3. Mic picker: switch B to another (fake) microphone mid-call; A keeps hearing B.
await connectedTo(A, B);
await B.page.click('#settings-button');
await B.page.click('#settings-tab-mic');
await B.page.waitForSelector('#mic-select');
const options = await B.page.$$eval('#mic-select option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
const before = await B.page.evaluate(() => window.__house.voice.stream?.getAudioTracks()[0]?.getSettings().deviceId);
const pick = options.find((o) => o.v && o.v !== before) ?? options[1];
await B.page.selectOption('#mic-select', pick.v);
await B.page.waitForTimeout(1500);
const after = await B.page.evaluate(() => ({
  device: window.__house.voice.stream?.getAudioTracks()[0]?.getSettings().deviceId,
  saved: localStorage.getItem('diesel-house.mic-device'),
}));
const aHearsB = await hearing(A, B);
check('mic picker lists mics and switches live; A still hears B', { options: options.length, before, after, aHearsB }, options.length >= 2 && after.saved === pick.v && after.device === pick.v && aHearsB > 0);
await B.page.click('#settings-close');

// 4. Supabase connection drops on B: the call keeps going, and B can still be found afterwards.
await B.page.evaluate((id) => (window.__house.voice.debug().find((d) => d.id === id).pc.__marker = 'original'), A.id);
await B.page.evaluate(() => window.__sockets.forEach((s) => s.readyState === 1 && s.close(4000, 'test: connection lost')));
await B.page.waitForFunction(() => window.__house.voice.channel?.state === 'joined' && window.__sockets.some((s) => s.readyState === 1), null, { timeout: 30000 }).catch(() => {});
await B.page.waitForTimeout(3000);
const kept = await B.page.evaluate((id) => {
  const d = window.__house.voice.debug().find((x) => x.id === id);
  return d && { state: d.state, sameCall: d.pc.__marker === 'original' };
}, A.id);
const stillHearing = [await hearing(A, B), await hearing(B, A)];
check('after a dropped Supabase connection, the A-B call carries on untouched', { kept, levels: stillHearing }, kept?.state === 'connected' && kept.sameCall && stillHearing.every((l) => l > 0));
const C = await player('Cat test', 18);
await tp(C, ...ROOM4);
const cLinked = (await connectedTo(C, B)) && (await connectedTo(B, C)) && (await connectedTo(C, A));
check('someone joining after the drop connects to B too', { cLinked }, cLinked);
const aSeesB = await A.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, B.id, { timeout: 15000 }).then(() => true, () => false);
check('B is still in the house for everyone else', { aSeesB }, aSeesB);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
