import { chromium } from 'playwright-core';
// Voices in rooms go through the mixer's 'voices' bus (src/net/voice.ts), so the Voices and Master
// sliders and each friend's own volume work on phones too (they ignore volume on <audio>). Plays a tone
// as a "friend's voice" through the same chain and measures the level. Needs `npm run dev`; no Supabase.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:5173/tests/e2e/harness.html');
await page.waitForFunction(() => !!window.harness);
const out = await page.evaluate(async () => {
  const { mixer } = await import('/src/ui/mixer.ts');
  const { audioContext } = await import('/src/net/audio.ts');
  const ctx = audioContext();
  await ctx.resume();
  const osc = ctx.createOscillator();
  const dest = ctx.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const src = ctx.createMediaStreamSource(dest.stream);
  const friend = ctx.createGain();
  src.connect(friend).connect(mixer.bus('voices'));
  // Listen after the master gain: tap it via a second bus connection on the same context.
  const an = ctx.createAnalyser();
  mixer.bus('voices').connect(an);
  const level = async () => {
    await new Promise((r) => setTimeout(r, 250));
    const d = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(d);
    return Math.round(Math.max(...d.map(Math.abs)) * 100) / 100;
  };
  const r = {};
  mixer.set('voices', 1);
  r.full = await level();
  mixer.set('voices', 0.3);
  r.voices30 = await level();
  mixer.set('voices', 0);
  r.voices0 = await level();
  mixer.set('voices', 1);
  friend.gain.value = 0.5;
  r.friendHalf = await level();
  return r;
});
check('the Voices slider and a friend’s own volume set how loud their voice is', out, out.full === 1 && out.voices30 === 0.3 && out.voices0 === 0 && out.friendHalf === 0.5);
console.log(res.join('\n'));
await browser.close();
if (res.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
