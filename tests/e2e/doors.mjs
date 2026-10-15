import { chromium } from 'playwright-core';
// Phase 6 doors with two real members, signing in through the login page. Needs `npm run dev` and two test
// accounts, given as environment variables (never commit them):
//   DH_TEST_OWNER="Name:password"     (owns room_01)
//   DH_TEST_VISITOR="Name:password"
// Leaves room_01's door open and removes the visitor's pass at the end.
const OWNER = process.env.DH_TEST_OWNER?.split(':');
const VISITOR = process.env.DH_TEST_VISITOR?.split(':');
if (!OWNER || !VISITOR) {
  console.log('SKIP  doors: set DH_TEST_OWNER and DH_TEST_VISITOR to run');
  process.exit(0);
}
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
async function setDoor(p, state) {
  await p.page.click('#settings-button');
  await p.page.waitForSelector(`#door-${state}`);
  await p.page.click(`#door-${state}`);
  await p.page.waitForFunction(() => document.getElementById('room-save-status')?.textContent === 'Saved', null, { timeout: 8000 }).catch(() => {});
  await p.page.click('#settings-close');
}

const O = await signIn(OWNER);
await O.page.waitForFunction((n) => window.__house.look.plate('room_01').label === `${n}'s room`, OWNER[0], { timeout: 10000 }).catch(() => {});
const plate = await O.page.evaluate(() => window.__house.look.plate('room_01').label);
check('owner signs in through the login page; room 1 is labelled with their name', { plate }, plate === `${OWNER[0]}'s room`);

// Owner sits in their room; door set to knock-first.
await tp(O, 96, 120);
await setDoor(O, 'knock');
const V = await signIn(VISITOR);
await V.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, O.id, { timeout: 15000 });
await V.page.waitForFunction(() => window.__house.look.plate('room_01').door === 'knock', null, { timeout: 8000 }).catch(() => {});

// Visitor walks into the knock door: stopped, and the owner hears a knock.
await tp(V, 96, 250);
await V.page.waitForTimeout(600);
await holdUp(V, 1500);
const blocked = await where(V);
await O.page.waitForSelector('#knock-toast', { timeout: 8000 }).catch(() => {});
const knockToast = await O.page.locator('#knock-toast .who').textContent().catch(() => null);
check('knock-first door stops the visitor and the owner sees "… is knocking"', { blocked, knockToast }, blocked.zone === 'hallway' && knockToast === `${VISITOR[0]} is knocking`);

// Owner lets them in; visitor walks in and joins the room's voice.
await O.page.click('#let-in');
await V.page.waitForFunction(() => window.__house.passes.has('room_01'), null, { timeout: 8000 }).catch(() => {});
await holdUp(V, 2500);
const inside = await where(V);
const voiceUp = await V.page
  .waitForFunction((id) => window.__house.voice.debug().some((d) => d.id === id && d.state === 'connected'), O.id, { timeout: 20000 })
  .then(() => true, () => false);
check('"Let in": the visitor walks in and is connected to the owner\'s voice', { inside, voiceUp }, inside.zone === 'room_01' && voiceUp);

// Owner locks up and removes the visitor.
await setDoor(O, 'locked');
await O.page.waitForFunction((id) => window.__house.remotes.get(id)?.info.zone === 'room_01', V.id, { timeout: 8000 }).catch(() => {});
const spot = await O.page.evaluate((id) => {
  const h = window.__house;
  const s = h.remotes.get(id).avatar.sprite;
  const cam = h.cameras.main;
  const c = h.game.canvas.getBoundingClientRect();
  return { x: c.left + (s.x - cam.worldView.x) * cam.zoom, y: c.top + (s.y - 12 - cam.worldView.y) * cam.zoom };
}, V.id);
await O.page.mouse.click(spot.x, spot.y);
await O.page.waitForSelector('#remove-guest', { timeout: 5000 }).catch(() => {});
const hasRemove = (await O.page.locator('#remove-guest').count()) === 1;
if (hasRemove) await O.page.click('#remove-guest');
await V.page.waitForFunction(() => window.__house.zone === 'hallway', null, { timeout: 8000 }).catch(() => {});
const out = await where(V);
const voiceGone = await V.page.evaluate(() => window.__house.voice.room === null);
check('owner removes the visitor: moved to the hallway, voice cut', { hasRemove, out, voiceGone }, hasRemove && out.zone === 'hallway' && voiceGone);

// Locked: walking in is refused, and the database refuses the voice channel too.
await V.page.waitForTimeout(3600); // past the door-message cooldown
await holdUp(V, 1500);
const lockedOut = await where(V);
const lockToast = await V.page.locator('#toasts .who', { hasText: 'is locked' }).count();
await V.page.evaluate(() => window.__house.voice.join('room_01'));
await V.page.waitForTimeout(4000);
const sneak = await V.page.evaluate(() => ({ channel: window.__house.voice.channel?.state ?? 'none', peers: window.__house.voice.debug().length }));
check('locked door: walking in refused, and voice refused by the server', { lockedOut, lockToast, sneak }, lockedOut.zone === 'hallway' && lockToast > 0 && sneak.channel !== 'joined' && sneak.peers === 0);
await V.page.evaluate(() => window.__house.voice.leave());

// Tidy up: door open again.
await setDoor(O, 'open');
console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
