import { chromium } from 'playwright-core';
// Phase 7 room chat with two real members (same accounts as doors.mjs). Needs `npm run dev` and:
//   DH_TEST_OWNER="Name:password"   DH_TEST_VISITOR="Name:password"
// Uses the garden; deletes its own messages at the end.
const A_ = process.env.DH_TEST_OWNER?.split(':');
const B_ = process.env.DH_TEST_VISITOR?.split(':');
if (!A_ || !B_) {
  console.log('SKIP  chat: set DH_TEST_OWNER and DH_TEST_VISITOR to run');
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

async function signIn([name, password]) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 }, permissions: ['microphone'] });
  await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#si-name');
  await page.fill('#si-name', name);
  await page.fill('#si-pass', password);
  await page.click('#signin .knock');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const ROOM2 = [600, 280]; // in the garden
const texts = (p) => p.page.$$eval('#msgs .dh-msg .text', (els) => els.map((e) => e.textContent));

const A = await signIn(A_);
const B = await signIn(B_);
await tp(A, ...ROOM2);
await tp(B, ...ROOM2);
await A.page.waitForSelector('#chat-button:not([hidden])', { timeout: 8000 });
check('in a room the chat button shows', { a: await A.page.isVisible('#chat-button'), b: await B.page.isVisible('#chat-button') }, (await A.page.isVisible('#chat-button')) && (await B.page.isVisible('#chat-button')));

// A opens chat and types; typing "wasd" must not move them.
await A.page.click('#chat-button');
await A.page.waitForSelector('#chat-input');
const before = await A.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
await A.page.click('#chat-input');
await A.page.keyboard.type('wasd ');
await A.page.keyboard.down('d');
await A.page.waitForTimeout(500);
await A.page.keyboard.up('d');
const after = await A.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
check('typing in chat never moves your character', { before, after }, before.x === after.x && before.y === after.y);
await A.page.fill('#chat-input', 'hi from the chat test');
await A.page.click('#chat-send');

// B: unread dot, then the message with A's name; bubble over A's head.
await B.page.waitForSelector('#unread:not([hidden])', { timeout: 10000 }).catch(() => {});
const unread = await B.page.isVisible('#unread');
const bubble = await B.page.evaluate((id) => !!window.__house.remotes.get(id)?.avatar.bubble, A.id);
await B.page.click('#chat-button');
await B.page.waitForFunction(() => [...document.querySelectorAll('#msgs .text')].some((t) => t.textContent === 'hi from the chat test'), null, { timeout: 10000 }).catch(() => {});
const seen = await B.page.evaluate(() => {
  const row = [...document.querySelectorAll('#msgs .dh-msg')].find((r) => r.querySelector('.text')?.textContent === 'hi from the chat test');
  return row && { name: row.querySelector('.name')?.textContent, time: row.querySelector('.time')?.textContent };
});
check('B gets an unread dot, a bubble over A, and the message with A\'s name and a local time', { unread, bubble, seen }, unread && bubble && seen?.name === A_[0] && /\d/.test(seen?.time ?? ''));

// B reacts with 👍; A sees it.
await B.page.click('#msgs .dh-msg:last-child .text');
await B.page.click('#msgs [data-react="👍"]');
await A.page.waitForSelector('#msgs .dh-react', { timeout: 10000 }).catch(() => {});
const chip = await A.page.locator('#msgs .dh-react').first().getAttribute('aria-label').catch(() => null);
check('B reacts 👍 and A sees it live', { chip }, chip === '👍 1');

// Late joiner: B leaves (chat hides) and comes back (history is there).
await tp(B, 520, 520);
await B.page.waitForTimeout(800);
const hidden = { panel: await B.page.locator('#chat').count(), button: await B.page.isVisible('#chat-button') };
await tp(B, ...ROOM2);
await B.page.waitForSelector('#chat-button:not([hidden])');
await B.page.click('#chat-button');
await B.page.waitForFunction(() => document.querySelectorAll('#msgs .dh-msg').length > 0, null, { timeout: 10000 }).catch(() => {});
const history = await texts(B);
check('leaving the room hides chat; coming back shows the history', { hidden, history: history.slice(-2) }, hidden.panel === 0 && !hidden.button && history.includes('hi from the chat test'));

// A deletes their message; it disappears for B.
await A.page.click('#msgs .dh-msg:last-child .text');
await A.page.click('#msgs [data-delete]');
await B.page.waitForFunction(() => ![...document.querySelectorAll('#msgs .text')].some((t) => t.textContent === 'hi from the chat test'), null, { timeout: 10000 }).catch(() => {});
const gone = !(await texts(B)).includes('hi from the chat test');
check('A deletes their own message; it disappears for B', { gone }, gone);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
