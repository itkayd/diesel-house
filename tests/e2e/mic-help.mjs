import { chromium } from 'playwright-core';
// When the browser blocks the mic, the game says so and shows how to fix it; once allowed, "Try again"
// turns the mic on without a reload. Needs `npm run dev` and DH_TEST_OWNER="Name:password".
const A_ = process.env.DH_TEST_OWNER?.split(':');
if (!A_) {
  console.log('SKIP  mic-help: set DH_TEST_OWNER to run');
  process.exit(0);
}
// Fake mic device, but no automatic permission: headless Chrome then refuses the mic (NotAllowedError).
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ permissions: [] });
await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1'));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForSelector('#si-name');
await page.fill('#si-name', A_[0]);
await page.fill('#si-pass', A_[1]);
await page.click('#signin .knock');
await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
await page.evaluate(() => { window.__house.body.reset(272, 120); window.__house.sendMove(true); });

await page.waitForSelector('#mic-toast', { timeout: 15000 }).catch(() => {});
const toastText = await page.locator('#mic-toast .who').textContent().catch(() => null);
const problem = await page.evaluate(() => window.__house.voice.micProblem);
check('mic refused: "Others can\'t hear you" shows straight away', { toastText, problem }, toastText === "Others can't hear you" && problem === 'denied');

await page.click('#mic-button');
await page.waitForSelector('#mic-help', { timeout: 5000 }).catch(() => {});
const help = await page.evaluate(() => ({ title: document.getElementById('mic-help-title')?.textContent, steps: [...document.querySelectorAll('#mic-help li')].map((l) => l.textContent) }));
check('tapping the mic button shows why and how to fix it', help, help.title === 'Your mic is blocked' && help.steps.length >= 2);

await ctx.grantPermissions(['microphone'], { origin: 'http://localhost:5173' });
await page.click('#mic-help-retry');
const on = await page.waitForFunction(() => !!window.__house.voice.stream, null, { timeout: 15000 }).then(() => true, () => false);
const status = await page.locator('#voice-status').textContent().catch(() => null);
check('after allowing the mic, "Try again" turns it on (no reload)', { on, status }, on && !/blocked/i.test(status ?? ''));

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
