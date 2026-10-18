import { chromium } from 'playwright-core';
// Doors with two real members (REDESIGN.md R1: no owners; "Do not disturb" instead of knock and lock),
// signing in through the login page. Needs `npm run dev` and two test accounts, given as environment
// variables (never commit them):
//   DH_TEST_OWNER="Name:password"     (any member: sits in Room 1 and asks for quiet)
//   DH_TEST_VISITOR="Name:password"   (any member: walks up to the door)
// Turns do not disturb off again at the end.
const OWNER = process.env.DH_TEST_OWNER?.split(':');
const VISITOR = process.env.DH_TEST_VISITOR?.split(':');
if (!OWNER || !VISITOR) {
  console.log('SKIP  doors: set DH_TEST_OWNER and DH_TEST_VISITOR to run');
  process.exit(0);
}
const browser = await chromium.launch({
  ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }),
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

async function signIn([name, password]) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, permissions: ['microphone'] });
  await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/CHANNEL_ERROR|Unauthorized/.test(m.text()) && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#si-name');
  await page.fill('#si-name', name);
  await page.fill('#si-pass', password);
  await page.click('#signin .knock');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const where = (p) => p.page.evaluate(() => ({ zone: window.__house.zone, y: Math.round(window.__house.player.y) }));
const holdUp = async (p, ms) => {
  await p.page.keyboard.down('ArrowUp');
  await p.page.waitForTimeout(ms);
  await p.page.keyboard.up('ArrowUp');
};
async function setQuiet(p, on) {
  await p.page.click('#settings-button');
  await p.page.click('#settings-tab-room');
  await p.page.waitForSelector('#room-dnd');
  if ((await p.page.locator('#room-dnd').isChecked()) !== on) await p.page.click('label[for="room-dnd"]');
  await p.page.waitForFunction(() => document.getElementById('room-save-status')?.textContent === 'Saved', null, { timeout: 8000 }).catch(() => {});
  await p.page.click('#settings-close');
}

const O = await signIn(OWNER);
const plate = await O.page.evaluate(() => window.__house.look.plate('room_01').label);
check('a member signs in through the login page; room 1 has its fixed name', { plate }, plate === 'Room 1');

// One member sits in Room 1 and asks for quiet.
await tp(O, 96, 120);
await O.page.waitForFunction(() => window.__house.zone === 'room_01', null, { timeout: 5000 }).catch(() => {});
await setQuiet(O, true);
const V = await signIn(VISITOR);
await V.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, O.id, { timeout: 15000 });
const sign = await V.page.waitForFunction(() => window.__house.look.plate('room_01').dnd, null, { timeout: 8000 }).then(() => true, () => false);
check('the other member sees "Do not disturb" on Room 1\'s door, live', { sign }, sign);

// The visitor walks into the door: stopped and asked, no lock.
await tp(V, 96, 250);
await V.page.waitForTimeout(600);
await holdUp(V, 1500);
const stopped = await where(V);
const asked = await V.page.waitForSelector('#quiet-toast', { timeout: 5000 }).then(() => true, () => false);
check('walking into a quiet room\'s door asks "Go in anyway?" first', { stopped, asked }, stopped.zone === 'hallway' && asked);

// "Go in": walks in and joins the room's voice (the server lets anyone in the house in).
await V.page.click('#quiet-go-in');
await V.page.waitForFunction(() => window.__house.zone === 'room_01', null, { timeout: 15000 }).catch(() => {});
const inside = await where(V);
const voiceUp = await V.page
  .waitForFunction((id) => window.__house.voice.debug().some((d) => d.id === id && d.state === 'connected'), O.id, { timeout: 20000 })
  .then(() => true, () => false);
check('"Go in": the visitor walks in and is connected to the room\'s voice', { inside, voiceUp }, inside.zone === 'room_01' && voiceUp);

// Both leave: the last one out clears do not disturb.
await tp(V, 96, 250);
await V.page.waitForTimeout(800);
await tp(O, 140, 250);
const cleared = await O.page
  .waitForFunction(() => window.__house.rooms.get('room_01')?.dnd === false, null, { timeout: 10000 })
  .then(() => true, () => false);
check('when the room empties, do not disturb goes away by itself', { cleared }, cleared);

// Tidy up, in case.
await O.page.evaluate(async () => (await import('/src/net/rooms.ts')).setDnd('room_01', false));
console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
