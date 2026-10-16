import { chromium } from 'playwright-core';
// Phase 8: the built site under the same headers as Vercel (`npm run build`, then `npx vite preview --port 4173`).
// Signs in, opens the chat and settings, and checks nothing is blocked by the security policy.
// Needs DH_TEST_OWNER="Name:password"; skips without it.
const A_ = process.env.DH_TEST_OWNER?.split(':');
if (!A_) {
  console.log('SKIP  deploy: set DH_TEST_OWNER to run');
  process.exit(0);
}
const BASE = process.env.DH_PREVIEW_URL ?? 'http://localhost:4173';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 }, permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/api\/turn/.test(m.text()) && errors.push('console: ' + m.text()));

const resp = await page.goto(BASE + '/');
const h = resp.headers();
check('security headers are sent (mic allowed for this site only)', { pp: h['permissions-policy'], csp: !!h['content-security-policy'] }, /microphone=\(self\)/.test(h['permissions-policy'] ?? '') && !!h['content-security-policy']);

const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
  const m = await (await fetch(href)).json();
  const icons = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).headers.get('content-type')));
  return { name: m.name, display: m.display, icons };
});
check('install to home screen: manifest and icons load', manifest, manifest.name === 'Diesel House' && manifest.icons.every((t) => t === 'image/png'));

await page.waitForSelector('#si-name');
await page.fill('#si-name', A_[0]);
await page.fill('#si-pass', A_[1]);
await page.click('#signin .knock');
const inside = await page.waitForSelector('#settings-button', { timeout: 20000 }).then(() => true, () => false);
const fonts = await page.evaluate(() => document.fonts.check('16px "Pixelify Sans"'));
check('built site: member signs in and the game starts, fonts load', { inside, fonts }, inside && fonts);

await page.click('#settings-button');
await page.click('#settings-tab-more');
await page.click('#credits-button');
const credits = await page.$$eval('#credits li a', (as) => as.map((a) => a.textContent));
check('settings → Credits lists every pack', { credits }, ['Modern Interiors', 'Modern Chibis', 'Roguelike Indoors', 'Lucide', 'OpenMoji'].every((c) => credits.includes(c)));
await page.click('#credits-close');
await page.click('#settings-close');

// Live connection (Supabase Realtime over wss) and the reaction images, both under the security policy.
const live = await page.waitForFunction(() => /in the house/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 15000 }).then(() => true, () => false);
const emoji = await page.evaluate(() => new Promise((ok) => {
  const img = new Image();
  img.onload = () => ok(img.naturalWidth > 0);
  img.onerror = () => ok(false);
  img.src = 'assets/ui/openmoji/1F44D.svg';
}));
check('live connection works and reaction emojis load', { live, emoji }, live && emoji);
console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors (nothing blocked)');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
