import { chromium } from 'playwright-core';
// Profile (FIXES.md 6): HUD button or tap your own name tag; About / Guest code / Badges; rename; change
// character; guests get a small card. Needs `npm run dev` and real test members:
//   DH_TEST_OWNER="Name:password"   DH_TEST_VISITOR="Name:password"
// Puts the owner's name and guest-code switch back afterwards.
const A_ = process.env.DH_TEST_OWNER?.split(':');
const B_ = process.env.DH_TEST_VISITOR?.split(':');
if (!A_ || !B_) {
  console.log('SKIP  profile: set DH_TEST_OWNER and DH_TEST_VISITOR to run');
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
async function open(name, phone = false) {
  const size = phone ? { viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true } : { viewport: { width: 1000, height: 700 } };
  const ctx = await browser.newContext({ ...size, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#si-name');
  return page;
}
async function signIn([name, password], phone) {
  const page = await open(name, phone);
  await page.fill('#si-name', name);
  await page.fill('#si-pass', password);
  await page.click('#signin .knock');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}

const A = await signIn(A_, true);
const B = await signIn(B_);
await B.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 15000 });

// HUD button → Profile, About tab.
await A.page.click('#xp-chip');
await A.page.waitForSelector('#profile-body .v2-facts');
const about = await A.page.$eval('#profile-body', (b) => b.textContent);
const fits = await A.page.$eval('#profile .dh-panel', (p) => p.scrollWidth <= p.clientWidth + 1);
check('Profile from the HUD: owned room, "Joined with an invite from Diesel on …", fits a 360 px phone', { about: about.slice(0, 120), fits },
  about.includes(`Owns ${A_[0]}'s room`) && /Joined with an invite from Diesel on \d/.test(about) && fits);

// Rename: friends see it; then put it back.
await A.page.fill('#profile-name', `${A_[0]} Renamed`);
await A.page.press('#profile-name', 'Enter');
const seen = await B.page.waitForFunction(([id, n]) => window.__house.remotes.get(id)?.info.name === n, [A.id, `${A_[0]} Renamed`], { timeout: 10000 }).then(() => true, () => false);
const plate = await B.page.waitForFunction((n) => window.__house.look.plate('room_01').label === `${n}'s room`, `${A_[0]} Renamed`, { timeout: 5000 }).then(() => true, () => false);
await A.page.fill('#profile-name', A_[0]);
await A.page.press('#profile-name', 'Enter');
await B.page.waitForFunction(([id, n]) => window.__house.remotes.get(id)?.info.name === n, [A.id, A_[0]], { timeout: 10000 }).catch(() => {});
check('renaming in Profile: friends see the new name (and on your door sign)', { seen, plate }, seen && plate);

// Guest code tab: format, copy, switch.
await A.page.click('#profile-tab-code');
await A.page.waitForSelector('#profile-code, #profile-make-code');
if (await A.page.locator('#profile-make-code').count()) await A.page.click('#profile-make-code');
await A.page.waitForSelector('#profile-code');
const code = (await A.page.textContent('#profile-code')).trim();
await A.page.click('#profile-copy');
const clip = await A.page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
const wasOn = await A.page.isChecked('#profile-code-on');
await A.page.click('#profile-code-on');
await A.page.waitForTimeout(800);
const switched = await A.page.evaluate(async () => (await import('/src/net/guestCodes.ts')).myGuestCode(window.__house.presence.id).then((g) => g?.enabled));
await A.page.click('#profile-code-on'); // back as it was
await A.page.waitForTimeout(800);
check('Guest code tab: ABCD-1234 code, Copy puts it on the clipboard, the switch turns it on/off',
  { code: code.replace(/[A-Z]/g, 'A').replace(/\d/g, '1'), copied: clip === code, wasOn, switched },
  /^[A-Z]{4}-\d{4}$/.test(code) && clip === code && switched === !wasOn);

// Badges tab (Phase 14): the 6 rank medals (Visitor earned on arrival) and 10 badges; tapping explains.
await A.page.click('#profile-tab-badges');
const medals = await A.page.evaluate(() => ({
  ranks: document.querySelectorAll('#profile-ranks .v2-badge').length,
  visitor: !document.querySelector('#profile-ranks [data-badge="rank_visitor"]')?.classList.contains('locked'),
  badges: document.querySelectorAll('.v2-badges .v2-badge').length,
}));
await A.page.click('.v2-badges [data-badge="first_knock"]');
const info = await A.page.textContent('#badge-info');
check('Badges tab: 6 rank medals (Visitor earned) and 10 badges; tapping one says how to earn it', { ...medals, info },
  medals.ranks === 6 && medals.visitor && medals.badges === 10 && /First knock/.test(info) && /Knock on a friend/.test(info));

// Portrait → character picker.
await A.page.click('#profile-face');
const picker = await A.page.waitForSelector('#picker', { timeout: 5000 }).then(() => true, () => false);
await A.page.click('#picker-close').catch(() => {});
check('tapping the portrait opens the character picker', { picker }, picker);

// Tapping your own name tag opens Profile.
await A.page.waitForTimeout(400);
const spot = await A.page.evaluate(() => {
  const h = window.__house;
  const t = h.me.tag;
  const cam = h.cameras.main;
  const c = h.game.canvas.getBoundingClientRect();
  return { x: c.left + (t.x - cam.worldView.x) * cam.zoom, y: c.top + (t.y - 4 - cam.worldView.y) * cam.zoom };
});
await A.page.mouse.click(spot.x, spot.y);
const viaTag = await A.page.waitForSelector('#profile', { timeout: 3000 }).then(() => true, () => false);
await A.page.click('#profile-close').catch(() => {});
check('tapping your own name tag opens your profile', { viaTag }, viaTag);

// A guest's profile: whose guest, time left.
const G = await open('guest');
await G.click('[data-go="guest"]');
await G.fill('#gs-code', code);
await G.click('#guest .knock');
await G.waitForSelector('#player-name', { timeout: 20000 });
await G.fill('#player-name', 'Sam profile');
await G.click('button[data-character="18"]');
await G.click('#picker-done');
await G.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
await G.click('#xp-chip');
await G.waitForFunction(() => /\d+ h \d+ min/.test(document.getElementById('profile-time-left')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
const guestCard = await G.evaluate(() => ({
  of: document.getElementById('profile-guest-of')?.textContent,
  left: document.getElementById('profile-time-left')?.textContent,
  tabs: document.querySelectorAll('#profile [role=tab]').length,
}));
check('guests get a small profile: "Guest of …" and time left, no tabs', guestCard, guestCard.of === `Guest of ${A_[0]}` && /^1[0-2] h \d+ min$/.test(guestCard.left ?? '') && guestCard.tabs === 0);
await G.evaluate(async () => {
  document.getElementById('profile-close')?.click();
  document.getElementById('settings-button').click();
  await new Promise((r) => setTimeout(r, 300));
  document.getElementById('settings-tab-more')?.click();
  await new Promise((r) => setTimeout(r, 300));
  document.getElementById('sign-out')?.click();
});
await G.waitForTimeout(1200);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
