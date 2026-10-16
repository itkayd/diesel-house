import { chromium } from 'playwright-core';
// A page that was open when a new version went live picks it up: on coming back to the front it reloads
// (when not in a call); in a call it only offers "Reload". Also: the connection rating shows within a few
// seconds. Dev test mode (src/ui/update.ts is told its "current" version, as dev files aren't hashed).
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];

async function open() {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('diesel-house.name', 'Updater');
    localStorage.setItem('diesel-house.character', '16');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // The site now serves a "new" version (only for the page's background check, a fetch of /).
  await page.route('http://localhost:5173/', async (route) => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    route.fulfill({ contentType: 'text/html', body: '<script type="module" src="/assets/main-NEWVERSION.js"></script>' });
  });
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { ctx, page };
}

// 1. Not in a call: coming back to the page reloads it.
{
  const { ctx, page } = await open();
  const t0 = Date.now();
  const net = await page.waitForFunction(() => !!document.querySelector('#net'), null, { timeout: 8000 }).then(() => Date.now() - t0, () => null);
  check('the connection rating shows within a few seconds', { ms: net }, net !== null && net < 8000);
  const reloaded = page.waitForEvent('framenavigated', { timeout: 8000 }).then(() => true, () => false);
  await page.evaluate(async () => {
    const { watchForNewVersion } = await import('/src/ui/update.ts');
    sessionStorage.removeItem('diesel-house.reloaded-at');
    watchForNewVersion(() => false, () => (window.__offered = true), '/assets/main-OLDVERSION.js');
  });
  check('new version, not in a call: the page reloads itself', { reloaded: await reloaded }, await reloaded);
  await ctx.close();
}

// 2. In a call: it only offers to reload.
{
  const { ctx, page } = await open();
  let navigated = false;
  page.on('framenavigated', () => (navigated = true));
  await page.evaluate(async () => {
    const { watchForNewVersion } = await import('/src/ui/update.ts');
    watchForNewVersion(() => true, () => (window.__offered = true), '/assets/main-OLDVERSION.js');
  });
  await page.waitForTimeout(1500);
  const offered = await page.evaluate(() => !!window.__offered);
  check('new version during a call: no reload, "Reload" is offered instead', { offered, navigated }, offered && !navigated);
  await ctx.close();
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
