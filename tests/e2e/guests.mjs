import { chromium } from 'playwright-core';
// Guests: a member's guest code (ABCD-1234) lets a guest in, and everyone sees whose friend they are,
// over their head and in chat. Needs `npm run dev`, "Allow anonymous sign-ins" on in Supabase, and:
//   DH_TEST_OWNER="Name:password"   DH_TEST_VISITOR="Name:password"
const A_ = process.env.DH_TEST_OWNER?.split(':');
const B_ = process.env.DH_TEST_VISITOR?.split(':');
if (!A_ || !B_) {
  console.log('SKIP  guests: set DH_TEST_OWNER and DH_TEST_VISITOR to run');
  process.exit(0);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 }, permissions: ['microphone'] });
  await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#si-name');
  return page;
}
async function signIn([name, password]) {
  const page = await open(name);
  await page.fill('#si-name', name);
  await page.fill('#si-pass', password);
  await page.click('#signin .knock');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const ROOM2 = [272, 120];

// Tester's guest code: new format, and switched on.
const A = await signIn(A_);
await A.page.click('#settings-button');
await A.page.waitForSelector('#guest-code, #make-guest-code', { timeout: 10000 });
if (await A.page.locator('#make-guest-code').count()) {
  await A.page.click('#make-guest-code');
  await A.page.waitForSelector('#guest-code');
}
const code = (await A.page.locator('#guest-code').textContent()).trim();
const on = await A.page.locator('#guest-code-on').isChecked();
if (!on) await A.page.click('#guest-code-on');
await A.page.click('#settings-close');
check('guest codes look like ABCD-1234', { format: code.replace(/[A-Z]/g, 'A').replace(/\d/g, '1') }, /^[A-HJKMNP-Z]{4}-\d{4}$/.test(code));

// A guest comes in with it and picks a name.
const G = { name: 'Sam test', page: await open('guest') };
await G.page.click('[data-go="guest"]');
await G.page.fill('#gs-code', code);
await G.page.click('#guest .knock');
const picker = await G.page.waitForSelector('#player-name', { timeout: 20000 }).then(() => true, () => false);
if (!picker) {
  const why = await G.page.locator('#guest .error').textContent().catch(() => '');
  console.log(res.join('\n'));
  console.log(`FAIL  guest could not get in (${why}). Is "Allow anonymous sign-ins" on in Supabase (Authentication > Sign In / Providers)?`);
  await browser.close();
  process.exit(1);
}
if (picker) {
  await G.page.fill('#player-name', G.name);
  await G.page.click('button[data-character="3"]');
  await G.page.click('#picker-done');
}
await G.page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 }).catch(() => {});
G.id = await G.page.evaluate(() => window.__house?.presence?.id);
check('a guest gets in with the code', { picker, joined: !!G.id }, picker && !!G.id);

// Visitor (another member) sees "Sam test · friend of Tester" over the guest's head.
const B = await signIn(B_);
const tag = await B.page
  .waitForFunction((id) => /friend of/.test(window.__house.remotes.get(id)?.avatar.tagText.text ?? ''), G.id, { timeout: 10000 })
  .then(() => B.page.evaluate((id) => window.__house.remotes.get(id).avatar.tagText.text, G.id), () => B.page.evaluate((id) => window.__house.remotes.get(id)?.avatar.tagText.text ?? null, G.id));
check('other friends see the guest tagged with whose friend they are', { tag }, tag === `${G.name} · friend of ${A_[0]}`);

const settingsLine = await G.page.evaluate(async () => {
  document.getElementById('settings-button').click();
  await new Promise((r) => setTimeout(r, 300));
  const t = [...document.querySelectorAll('.dh-lede')].map((e) => e.textContent).find((t) => /Visiting/.test(t));
  document.getElementById('settings-close')?.click();
  return t;
});
check("the guest's own settings say whose friend they are", { settingsLine }, settingsLine === `Visiting as ${A_[0]}'s friend (${G.name})`);

// In chat too.
await tp(G, ...ROOM2);
await tp(B, ...ROOM2);
await G.page.waitForSelector('#chat-button:not([hidden])', { timeout: 8000 });
await G.page.click('#chat-button');
await G.page.fill('#chat-input', 'hello from a guest');
await G.page.click('#chat-send');
await B.page.click('#chat-button');
await B.page.waitForFunction(() => [...document.querySelectorAll('#msgs .text')].some((t) => t.textContent === 'hello from a guest'), null, { timeout: 10000 }).catch(() => {});
const chatName = await B.page.evaluate(() => {
  const row = [...document.querySelectorAll('#msgs .dh-msg')].find((r) => r.querySelector('.text')?.textContent === 'hello from a guest');
  return row?.querySelector('.name')?.textContent ?? null;
});
check('chat shows the guest as a friend of Tester', { chatName }, chatName === `${G.name} · friend of ${A_[0]}`);

// Tidy up: the guest deletes the message and leaves.
await G.page.click('#msgs .dh-msg:last-child .text').catch(() => {});
await G.page.click('#msgs [data-delete]').catch(() => {});
await G.page.waitForTimeout(800);
await G.page.evaluate(async () => {
  document.getElementById('settings-button').click();
  await new Promise((r) => setTimeout(r, 300));
  document.getElementById('sign-out')?.click();
});
await G.page.waitForTimeout(1500);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
