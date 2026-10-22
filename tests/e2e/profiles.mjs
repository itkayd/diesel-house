import { chromium } from 'playwright-core';
// Everyone's profile and private messages (test mode, a pretend "Zara" next to you): the tap menu's
// Profile opens hers (level, rank, stats, medals, Add friend · Message · Report · Block); Message opens a
// conversation; sending shows your bubble; a message from her pops up with Reply and counts on the
// Messages button; blocked, she can't be messaged.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const SHOTS = process.env.DH_SHOTS;
async function run(label, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(() => {
    localStorage.setItem('diesel-house.name', 'Me');
    localStorage.setItem('diesel-house.character', 'ninja.villager2');
    localStorage.setItem('diesel-house.mic-ok', '1');
    localStorage.setItem('diesel-house.guide-seen', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove && !!window.__dms, null, { timeout: 30000 });
  const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/profiles-${label}-${n}.png` });
  await page.evaluate(() => {
    const h = window.__house;
    h.addRemote({ id: 'zara-1', name: 'Zara', character: 'ninja.princess', zone: 'hallway', lv: 23, st: 4 });
    h.receiveMove({ id: 'zara-1', x: h.player.x + 24, y: h.player.y, vx: 0, vy: 0, dir: 'down', zone: 'hallway', t: Date.now() });
  });
  await page.waitForFunction(() => window.__house.remotes.get('zara-1')?.active);
  return { page, shot, ctx };
}

{
  const { page, shot, ctx } = await run('phone', { width: 390, height: 844 }, true);
  await page.evaluate(() => window.__house.tapAvatar('zara-1'));
  await page.waitForSelector('#friend-profile');
  await page.tap('#friend-profile');
  await page.waitForSelector('#player-profile .v2-pp-name');
  const prof = await page.evaluate(() => ({
    name: document.querySelector('#player-profile .v2-pp-name')?.textContent,
    chips: [...document.querySelectorAll('#player-profile .v2-chip')].map((c) => c.textContent),
    stats: document.querySelectorAll('#player-profile .v2-stat').length,
    acts: ['pp-friend', 'pp-message', 'pp-report', 'pp-block'].filter((id) => document.getElementById(id)),
    where: document.querySelector('#player-profile .v2-note')?.textContent,
  }));
  await shot('1-profile');
  check('tap → Profile: name, level and rank, stats, where she is, and Add friend · Message · Report · Block', prof,
    prof.name === 'Zara' && prof.chips.some((c) => c.startsWith('Lv 23')) && prof.chips.some((c) => /Regular/.test(c)) && prof.stats === 6 && prof.acts.length === 4 && /Great Hall/.test(prof.where ?? ''));

  // Message her.
  await page.tap('#pp-message');
  await page.waitForSelector('#dm-chat #dm-input');
  const sendOff = await page.isDisabled('#dm-send');
  await page.fill('#dm-input', 'hey Zara, quiz at 8?');
  await page.tap('#dm-send');
  await page.waitForSelector('#dm-list .dm-msg.mine');
  const mine = await page.textContent('#dm-list .dm-msg.mine .tx');
  // She answers while the conversation is open: it appears there.
  await page.evaluate(() => window.__dms.testIncoming('zara-1', 'yes! see you there'));
  await page.waitForSelector('#dm-list .dm-msg:not(.mine)');
  await shot('2-conversation');
  check('Message: Send waits for text; your message shows; her reply appears in the open conversation', { sendOff, mine }, sendOff && mine === 'hey Zara, quiz at 8?');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('.dh-scrim').forEach((s) => s.remove()));

  // A message while elsewhere: a pop-up with Reply, and a count on the Messages button.
  await page.evaluate(() => window.__dms.testIncoming('zara-1', 'are you coming?'));
  const pop = await page.waitForSelector('#dm-toast', { timeout: 3000 }).then((e) => e.textContent(), () => null);
  const count = await page.textContent('#messages-button .dh-count');
  await shot('3-popup');
  check('a new message elsewhere: pop-up “Zara · are you coming?” with Reply, and a count on Messages', { pop, count }, /Zara/.test(pop ?? '') && /are you coming/.test(pop ?? '') && /Reply/.test(pop ?? '') && Number(count) >= 1);
  await page.tap('#dm-reply');
  await page.waitForSelector('#dm-chat');
  const opened = await page.evaluate(() => document.getElementById('dm-title')?.textContent);
  check('Reply opens the conversation with her', opened, opened === 'Zara');
  await page.evaluate(() => document.querySelectorAll('.dh-scrim').forEach((s) => s.remove()));

  // Blocked: no Message button, and her messages don't arrive.
  await page.evaluate(() => window.__social.testSocial([], [{ id: 'zara-1', name: 'Zara' }]));
  await page.evaluate(() => window.__house.openProfileOf('zara-1', 'Zara'));
  await page.waitForSelector('#player-profile .v2-pp-name');
  const blocked = await page.evaluate(() => ({ message: !!document.getElementById('pp-message'), unblock: !!document.getElementById('pp-unblock') }));
  await page.evaluate(() => document.querySelectorAll('.dh-scrim, .dh-toast').forEach((s) => s.remove()));
  await page.evaluate(() => window.__dms.testIncoming('zara-1', 'hello??'));
  await page.waitForTimeout(300);
  const toastAfter = await page.$('#dm-toast');
  check('blocked: her profile has Unblock instead of Message, and her messages don’t reach you', { ...blocked, toast: !!toastAfter }, !blocked.message && blocked.unblock && !toastAfter);
  await ctx.close();
}

// Desktop: the same profile looks right wide.
{
  const { page, shot, ctx } = await run('desktop', { width: 1280, height: 800 }, false);
  await page.evaluate(() => window.__house.openProfileOf('zara-1', 'Zara'));
  await page.waitForSelector('#player-profile .v2-pp-name');
  await shot('4-profile');
  check('desktop: the profile opens', true, true);
  await ctx.close();
}

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
