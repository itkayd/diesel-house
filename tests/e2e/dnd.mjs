import { chromium } from 'playwright-core';
// REDESIGN.md R1: rooms have no owners; "Do not disturb" replaces knock and lock. Runs in dev test mode
// (no Supabase): a pretend friend sits in the Garden and the room is marked quiet, as the database would
// tell us. Checks the dark sign on the door (only while someone is inside), the soft "Go in anyway?"
// question, that the door holds until you say yes, walking in after "Go in", and the Room settings tab.
// Set DH_CHROMIUM to use a Chromium instead of Edge.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Quietly');
  localStorage.setItem('diesel-house.character', '2');
  localStorage.setItem('diesel-house.mic-ok', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && !document.getElementById('picker'), null, { timeout: 20000 });
const zone = () => page.evaluate(() => window.__house.zone);
const plate = () => page.evaluate(() => ({ dnd: window.__house.look.plate('garden').dnd, label: window.__house.look.plate('garden').label }));

// The Garden is quiet, but empty: no sign (it clears when someone finds it empty).
await page.evaluate(() => window.__house.roomChanged({ id: 'garden', active: true, dnd: true, dnd_set_by: 'x', games: null, prompts: null }));
const empty = await plate();
// A friend is in there.
await page.evaluate(() => {
  const h = window.__house;
  h.addRemote({ id: 'friend', name: 'Sam', character: 5, zone: 'garden' });
  h.receiveMove({ id: 'friend', x: 640, y: 288, vx: 0, vy: 0, dir: 'down', zone: 'garden', t: Date.now() });
});
await page.waitForTimeout(200);
const occupied = await plate();
check('the door sign shows "Do not disturb" only while someone is inside', { empty, occupied }, !empty.dnd && occupied.dnd && occupied.label === 'Garden');

// Walk to the Garden: you stop at the door and are asked first.
await page.evaluate(() => window.__house.walkToRoom('garden'));
await page.waitForSelector('#quiet-toast', { timeout: 30000 });
await page.waitForTimeout(600);
const asked = { zone: await zone(), text: await page.locator('#quiet-toast').textContent() };
check('walking to a quiet room stops at its door with "Go in anyway?"', asked, asked.zone === 'hallway' && /asked for some quiet/.test(asked.text));

// Pushing on doesn't get you in.
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(700);
await page.keyboard.up('ArrowUp');
const held = await zone();
// "Go in": you walk in.
await page.click('#quiet-go-in');
await page.waitForFunction(() => window.__house.zone === 'garden', null, { timeout: 30000 }).catch(() => {});
const inside = await zone();
check('the door holds until you choose "Go in", then you walk in', { held, inside }, held === 'hallway' && inside === 'garden');

// Settings → Room: the room you're in, with the do-not-disturb switch on (no rename, door or mood).
await page.click('#settings-button');
await page.click('[data-tab="room"], #settings-tab-room').catch(() => {});
await page.waitForSelector('#room-dnd', { timeout: 4000 }).catch(() => {});
const tab = await page.evaluate(() => ({
  title: document.getElementById('room-settings-title')?.textContent,
  dnd: document.getElementById('room-dnd')?.checked,
  old: ['room-name', 'door-knock', 'door-locked', 'mood-chill'].filter((id) => document.getElementById(id)),
}));
check('the Room tab is for the room you are in: do not disturb on, nothing to own or rename', tab, tab.title === 'Garden' && tab.dnd === true && tab.old.length === 0);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
