import { chromium } from 'playwright-core';
// U4 · Social and safety (test mode, a pretend person "Zara" next to you): the friend menu has Add friend,
// Block and Report; Report sends with a reason; Block asks first, then her emotes, duels and table invites
// don't reach you; Settings → More lists her with Unblock; friends and requests show in Who's where with
// Join / Accept; "Invite friends to this table" asks friends in the house; an invite shows Go.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Social');
  localStorage.setItem('diesel-house.character', 'ninja.villager2');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove && !!window.__social, null, { timeout: 30000 });
const SHOTS = process.env.DH_SHOTS;
const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/social-${n}.png` });

// Zara arrives next to us.
await page.evaluate(() => {
  const h = window.__house;
  h.addRemote({ id: 'zara-1', name: 'Zara', character: 'ninja.princess', zone: 'hallway' });
  h.receiveMove({ id: 'zara-1', x: h.player.x + 24, y: h.player.y, vx: 0, vy: 0, dir: 'down', zone: 'hallway', t: Date.now() });
});
await page.waitForFunction(() => window.__house.remotes.get('zara-1')?.active);
const openMenu = () => page.evaluate(() => window.__house.tapAvatar('zara-1'));

// The menu.
await openMenu();
await page.waitForSelector('#friend-menu');
const menu = await page.evaluate(() => ({ add: document.querySelector('#friend-add')?.textContent, block: !!document.querySelector('#friend-block'), report: !!document.querySelector('#friend-report') }));
await shot('1-menu');
check('tap someone: Add friend, Block and Report are there', menu, menu.add === 'Add friend' && menu.block && menu.report);

// Report.
await page.tap('#friend-report');
await page.waitForSelector('#report-form');
const sendOff = await page.isDisabled('#report-send-player');
await page.tap('#report-form [data-reason="harassment"]');
await page.fill('#report-details', 'kept following me around');
await shot('2-report');
await page.tap('#report-send-player');
const sent = await page.waitForFunction(() => [...document.querySelectorAll('.dh-toast')].some((t) => t.textContent.includes('Report sent')), null, { timeout: 3000 }).then(() => true, () => false);
check('Report: pick a reason (Send waits for one), add words, send: “Report sent”', { sendOff, sent }, sendOff && sent);

// Block.
await openMenu();
await page.tap('#friend-block');
await page.waitForSelector('#block-confirm');
await shot('3-block');
await page.tap('#block-yes');
await page.waitForFunction(() => window.__social.isBlocked('zara-1'));
const blockedEffects = await page.evaluate(() => {
  const h = window.__house;
  const z = h.remotes.get('zara-1');
  const before = z.avatar.emote ?? null;
  h.receiveEmote({ from: 'zara-1', e: 'wave', to: h.presence?.id });
  h.receiveInvite({ from: 'zara-1', to: ['me'], spot: 'lounge', name: 'Zara' });
  h.receiveDuel({ k: 'invite', id: 'd1', from: 'zara-1', to: h.presence?.id ?? 'me' });
  return {
    tableInvite: !!document.getElementById('table-invite'),
    duelInvite: !!document.getElementById('duel-invite'),
    emoteShown: (z.avatar.emote ?? null) !== before,
    volume: h.voice ? null : 'no voice in test mode',
  };
});
check('blocked: her emotes, table invites and duel invites don’t reach you', blockedEffects, !blockedEffects.tableInvite && !blockedEffects.duelInvite && !blockedEffects.emoteShown);

// Unblock in Settings → More.
await page.evaluate(() => document.querySelectorAll('.dh-toast').forEach((t) => t.remove()));
await page.click('#settings-button');
await page.click('#settings-tab-more');
await page.waitForSelector('[data-blocked="zara-1"]', { timeout: 5000 });
await shot('4-blocked-list');
await page.locator('[data-blocked="zara-1"] button').click();
await page.waitForFunction(() => !window.__social.isBlocked('zara-1'));
check('Settings → More → Blocked people: Zara listed, Unblock works', true, true);
await page.keyboard.press('Escape');
await page.evaluate(() => document.getElementById('settings-close')?.click());

// Friends in Who's where.
await page.evaluate(() =>
  window.__social.testSocial([
    { id: 'zara-1', name: 'Zara', character: 'ninja.princess', level: 4, status: 'friends', since: null, last_seen: null },
    { id: 'bo-2', name: 'Bo', character: 'ninja.oldman', level: 2, status: 'incoming', since: null, last_seen: null },
    { id: 'kim-3', name: 'Kim', character: 'ninja.woman', level: 9, status: 'friends', since: null, last_seen: new Date(Date.now() - 3 * 86400_000).toISOString() },
  ]),
);
await page.tap('#map-button');
await page.waitForSelector('#friends-list');
const friendsUi = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#friends-list [data-friend]')].map((r) => ({ id: r.dataset.friend, text: r.textContent, acts: [...r.querySelectorAll('[data-act]')].map((b) => b.dataset.act) })),
}));
await shot('5-friends');
const byId = Object.fromEntries(friendsUi.rows.map((r) => [r.id, r]));
check('Who’s where: requests first (Accept), friends in the house (Join), friends away (last on)', friendsUi.rows.map((r) => r.id),
  friendsUi.rows[0]?.id === 'bo-2' && byId['bo-2'].acts.includes('accept') && byId['zara-1'].acts.includes('join') && /Last on 3 days ago/.test(byId['kim-3'].text) && !byId['kim-3'].acts.length);
await page.tap('#friends-list [data-friend="zara-1"] [data-act="join"]');
const walking = await page.waitForFunction(() => !!window.__house.autoPath, null, { timeout: 3000 }).then(() => true, () => false);
check('Join walks you to them', walking, walking);
await page.keyboard.press('ArrowDown');

// Invite to a table, and getting one.
await page.evaluate(() => { const h = window.__house; h.autoPath = null; h.body.reset(723, 525); h.player.setPosition(723, 525); if (h.presence) h.presence.sendInvite = () => true; });
await page.waitForSelector('#game-prompt', { timeout: 5000 });
await page.tap('#game-prompt');
await page.waitForSelector('#games-invite');
await page.tap('#games-invite');
const said = await page.textContent('#games-invite');
await shot('6-invite');
check('“Invite friends to this table” asks friends in the house', said, /Invited Zara|offline/.test(said ?? ''));
await page.keyboard.press('Escape');
await page.evaluate(() => window.__house.receiveInvite({ from: 'zara-1', to: ['me'], spot: 'lounge', name: 'Zara' }));
const got = await page.waitForSelector('#table-invite', { timeout: 3000 }).then((e) => e.textContent(), () => null);
await shot('7-got-invite');
check('an invite from a friend: “Zara wants to play” with Go', got, /Zara wants to play/.test(got ?? '') && /Go/.test(got ?? ''));

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
