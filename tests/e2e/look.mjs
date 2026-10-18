import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Visual pass (NEXT.md 4.6): theme, HUD, nameplates with faces, room warmth, settings, picker.
// Needs `npm run dev`. Screenshots (including the login design next to the hallway) go to tests/e2e/output.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});

async function player(name, character, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([n, c]) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', c);
    localStorage.setItem('diesel-house.mic-ok', '1');
  }, [name, String(character)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { ctx, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);

const A = await player('Ada look', 16);
const theme = await A.page.evaluate(() => ({
  pixel: document.fonts.check('16px "Pixelify Sans"'),
  body: document.fonts.check('16px "Atkinson Hyperlegible"'),
  bg: getComputedStyle(document.body).backgroundColor,
  googleFonts: performance.getEntriesByType('resource').some((r) => r.name.includes('fonts.g')),
}));
check('fonts load locally (no Google call) and the page is night-coloured', theme, theme.pixel && theme.body && theme.bg === 'rgb(20, 15, 28)' && !theme.googleFonts);
const pill = async () => ({ zone: (await A.page.locator('#where-zone').textContent()).trim(), status: (await A.page.locator('#status').textContent()).trim() });
await A.page.waitForFunction(() => /in the house/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
const hallPill = await pill();
check('HUD pill in the hallway: "Great Hall · N in the house"', hallPill, hallPill.zone === 'Great Hall' && /^\d+ in the house$/.test(hallPill.status));
const plates = await A.page.evaluate(() => window.__house.children.list.filter((o) => o.name?.startsWith('plate-')).map((o) => o.name));
check('a nameplate over each of the 8 doors', { plates: plates.length }, plates.length === 8);

// B walks into the garden: A sees B's face on its nameplate, and the garden warms up.
const B = await player('Bo look', 17);
await A.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, B.id, { timeout: 15000 });
await tp(B, 600, 280);
await B.page.waitForFunction(() => window.__house.zone === 'garden', null, { timeout: 5000 }).catch(() => {});
await A.page.waitForFunction(() => window.__house.look.plate('garden').headCount === 1, null, { timeout: 8000 }).catch(() => {});
await A.page.waitForTimeout(800);
// Real visitors may be in other rooms, so every plate is compared with who A knows is in that room.
const room3 = await A.page.evaluate(() => {
  const h = window.__house;
  const rooms = ['garden', 'library', 'disco', 'gaming', 'cafe', 'lounge', 'rooftop'];
  const known = (r) => [...h.remotes.values()].filter((x) => x.active && x.info.zone === r).length;
  return {
    heads: h.look.plate('garden').headCount,
    allMatch: rooms.every((r) => h.look.plate(r).headCount === known(r)),
    emptyRoomsDark: rooms.filter((r) => known(r) === 0).every((r) => h.look.roomGlow.get(r).alpha === 0),
    warmth: +h.look.roomGlow.get('garden').alpha.toFixed(3),
  };
});
check('from the hallway: B\'s face on the garden\'s door, and the garden is lit up', room3, room3.heads >= 1 && room3.allMatch && room3.emptyRoomsDark && room3.warmth > 0.05);
await B.page.waitForFunction(() => document.getElementById('where-zone')?.textContent === 'Garden', null, { timeout: 5000 }).catch(() => {});
const bPill = { zone: await B.page.locator('#where-zone').textContent(), status: (await B.page.locator('#status').textContent()).trim() };
check('HUD pill in a room: "Garden · 1 here"', bPill, bPill.zone === 'Garden' && bPill.status === '1 here');

// Furniture blocks: walking up into the garden's log bench stops you at its base.
await tp(A, 634, 380);
await A.page.keyboard.down('ArrowUp');
await A.page.waitForTimeout(1500);
await A.page.keyboard.up('ArrowUp');
const aPos = await A.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
check('furniture blocks: walking up into the garden\'s log bench stops you at its base', aPos, aPos.y === 359);

// Settings: mic picker, push to talk and "show my name tag" all live there.
await A.page.click('#settings-button');
await A.page.click('#settings-tab-mic');
await A.page.waitForSelector('#ptt-toggle'); // sections fill in after the mic list loads
const micTab = await A.page.evaluate(() => ['mic-select', 'ptt-toggle'].map((id) => !!document.getElementById(id)));
await A.page.click('#settings-tab-more');
await A.page.waitForSelector('#show-own-tag');
const items = [...micTab, await A.page.evaluate(() => !!document.getElementById('show-own-tag'))];
await A.page.uncheck('#show-own-tag');
const tagHidden = await A.page.evaluate(() => !window.__house.me.tag.visible);
await A.page.check('#show-own-tag');
const tagBack = await A.page.evaluate(() => window.__house.me.tag.visible);
await A.page.click('#settings-close');
check('settings: mic, push to talk, name-tag switch (which works)', { items, tagHidden, tagBack }, items.every(Boolean) && tagHidden && tagBack);

// Picker: reopening from the profile button has a Close; nothing changes if you close it.
await A.page.click('#xp-chip');
await A.page.waitForSelector('#picker');
const hasClose = await A.page.locator('#picker-close').count();
await A.page.screenshot({ path: `${out}/look_picker.png` });
await A.page.click('#picker-close');
const after = await A.page.evaluate(() => ({ open: !!document.getElementById('picker'), char: localStorage.getItem('diesel-house.character') }));
check('profile button reopens the picker; Close keeps your character', { hasClose, ...after }, hasClose === 1 && !after.open && after.char === '16');

// Screenshots: hallway on a phone, a room on desktop, and the login design for comparison.
const phone = await player('Phone look', 18, { width: 390, height: 844 });
await tp(phone, 520, 520);
await phone.page.waitForTimeout(1200);
await phone.page.screenshot({ path: `${out}/look_hallway_phone.png` });
await tp(A, 600, 300);
await A.page.waitForTimeout(1500);
await A.page.screenshot({ path: `${out}/look_room3.png` });
const L = await browser.newPage({ viewport: { width: 390, height: 844 } });
await L.goto('http://localhost:5173/__login.html').catch(() => {});
if (await L.locator('#scene').count()) {
  await L.waitForTimeout(1500);
  await L.screenshot({ path: `${out}/look_login_phone.png` });
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
