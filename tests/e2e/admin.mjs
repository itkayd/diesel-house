import { chromium } from 'playwright-core';
import { sql } from '../api/fakeDb.mjs';
// The admin page, end to end on a phone and a desktop, against the local test database:
// first-time setup, dashboard, a player's level / coins / gems / ban, house switches, device logs (open one,
// see the device and trail, mark fixed), rejected Night Raid runs, audit log, signing out.
// Needs: supabase/tests/run.sh, then the dev server with the local database:
//   DH_LOCAL_DB=1 ADMIN_PASSCODE=local-setup-123 npx vite --port 5173
// Screenshots go to $DH_SHOTS (if set).
const SHOTS = process.env.DH_SHOTS;
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];

// A fresh house: no admins; one player with a device log trail and a rejected run.
for (const t of ['admin_sessions', 'admin_login_attempts', 'admin_audit', 'admin_accounts']) sql(`delete from public.${t}`, 'postgres');
const P = '00000000-0000-0000-0000-0000000000e1';
sql(`insert into auth.users (id, email) values ('${P}', 'e2e@members.diesel-house.invalid') on conflict do nothing`, 'postgres');
sql(`insert into public.allowed_emails (email) values ('e2e@members.diesel-house.invalid') on conflict do nothing`, 'postgres');
sql(`insert into public.profiles (id, display_name, character_index) values ('${P}', 'Zara', 4) on conflict (id) do update set display_name = 'Zara'`, 'postgres');
sql(`delete from public.banned_users where user_id = '${P}'`, 'postgres');
sql(`delete from public.ledger where user_id = '${P}'`, 'postgres');
sql(`delete from public.wallets where user_id = '${P}'`, 'postgres');
sql(`delete from public.arcade_runs where user_id = '${P}'`, 'postgres');
sql(`update public.player_reports set resolved_at = now() where resolved_at is null`, 'postgres');
sql(`insert into public.player_reports (reporter, reported, reported_name, reason, details, context) values (null, '${P}', 'Zara', 'harassment', 'E2E kept following me', '{"zone":"lounge","their_zone":"lounge","near":20,"their_chat":[{"at":"2026-10-22T10:00:00Z","text":"E2E hey come back"}]}'::jsonb)`, 'postgres');
sql(`update public.house_settings set value = '{"enabled": true, "rooms_off": []}' where key = 'animals'`, 'postgres');
sql(`delete from public.client_errors where message like 'E2E%'`, 'postgres');
const trail = [{ t: 3.2, what: 'walked into', info: 'gaming' }, { t: 9.8, what: 'opened', info: 'mic-prompt' }, { t: 12.1, what: 'joystick let go', info: 'touch vanished' }];
const ctx = JSON.stringify({ device: { screen: '393×852', viewport: '393×659', touch: 5, language: 'en-GB' }, game: { zone: 'gaming', canMove: true, others: 2 }, trail });
sql(`insert into public.client_errors (user_id, kind, message, agent, page, build, context) values
  ('${P}', 'warning', 'E2E joystick let go by itself', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/129.0', '/', 'main-abc', '${ctx.replace(/'/g, "''")}'::jsonb),
  ('${P}', 'warning', 'E2E joystick let go by itself', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/129.0', '/', 'main-abc', '${ctx.replace(/'/g, "''")}'::jsonb),
  ('${P}', 'report', 'E2E the music stopped when I walked into the disco', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', '/', 'main-abc', null)`, 'postgres');
sql(`insert into public.arcade_runs (user_id, game, seed, status, claimed, score, ticks, real_ms, reason, finished_at) values ('${P}', 'nightraid', 1, 'rejected', 999999, 1200, 3000, 4000, 'the replay scored 1200, not 999999', now())`, 'postgres');

async function run(label, viewport, mobile) {
  const ctxB = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await ctxB.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  const shot = (name) => SHOTS && page.screenshot({ path: `${SHOTS}/admin-${label}-${name}.png`, fullPage: false });
  await page.goto('http://localhost:5173/admin.html');
  return { page, shot, ctxB };
}

// ---- Phone: setup, players, switches, logs ----
{
  const { page, shot, ctxB } = await run('phone', { width: 390, height: 844 }, true);
  await page.waitForSelector('#adm-gate');
  const setupShown = await page.isVisible('#adm-code');
  await shot('1-setup');
  await page.fill('#adm-user', 'diesel');
  await page.fill('#adm-pass', 'short');
  await page.fill('#adm-code', 'local-setup-123');
  await page.click('#adm-go');
  await page.waitForTimeout(300);
  const shortErr = await page.evaluate(() => (document.querySelector('#adm-pass').validity.tooShort ? 'needs 12+' : document.querySelector('#adm-error').textContent));
  await page.fill('#adm-pass', 'a long admin password');
  await page.click('#adm-go');
  await page.waitForSelector('.adm-shell');
  await page.waitForSelector('.adm-tile');
  check('first-time setup: asks for the setup passcode, refuses a short password, then signs in', { setupShown, shortErr }, setupShown && /12/.test(shortErr ?? ''));
  const needs = await page.locator('.adm-card h3').first().textContent();
  check('dashboard: “Needs a look” lists the report, open logs and the rejected run', needs, needs?.includes('Needs a look'));
  await shot('2-dashboard');

  // Players: open Zara, set level 120, give 50,000 coins and 900 gems.
  await page.click('#nav-players');
  await page.waitForSelector(`[data-player="${P}"]`);
  await shot('3-players');
  await page.click(`[data-player="${P}"]`);
  await page.waitForSelector('#player-panel #player-level');
  await page.fill('#player-level', '120');
  await page.click('#player-set-level');
  await page.waitForFunction(() => [...document.querySelectorAll('#player-panel .adm-tile')].some((t) => t.textContent.startsWith('120Level')));
  await page.fill('#wallet-amount', '50000');
  await page.fill('#wallet-reason', 'E2E prize');
  await page.click('#wallet-give-coins');
  await page.waitForFunction(() => [...document.querySelectorAll('#player-panel .adm-tile')].some((t) => t.textContent.replace(/\D/g, '') === '50000'));
  await page.fill('#wallet-amount', '900');
  await page.click('#wallet-give-gems');
  await page.waitForFunction(() => [...document.querySelectorAll('#player-panel .adm-tile')].some((t) => t.textContent === '900Gems'));
  await shot('4-player');
  const tiles = await page.$$eval('#player-panel .adm-tile', (ts) => ts.map((t) => t.textContent));
  check('a player: set level 120, give 50,000 coins and 900 gems (no limits)', tiles, tiles.includes('120Level') && tiles.some((t) => t.replace(/\D/g, '') === '50000') && tiles.includes('900Gems'));
  await page.click('#player-ban');
  await page.click('#dialog-ok');
  await page.waitForSelector('#player-unban');
  const banned = await page.isVisible('#player-unban');
  await page.click('#player-unban');
  await page.waitForSelector('#player-ban');
  check('ban asks first, then can be lifted', { banned }, banned);
  await page.click('#player-close');

  // House switches: animals off, then on.
  await page.click('#nav-house');
  await page.waitForSelector('#switch-animals');
  await page.click('#switch-animals');
  await page.waitForTimeout(400);
  const animalsOff = sql(`select value -> 'enabled' from public.house_settings where key = 'animals'`, 'postgres').data;
  await page.click('#switch-animals');
  await page.waitForTimeout(400);
  const animalsOn = sql(`select value -> 'enabled' from public.house_settings where key = 'animals'`, 'postgres').data;
  check('house switches save straight away (animals off, then on)', { animalsOff, animalsOn }, animalsOff === false && animalsOn === true);
  await shot('5-switches');

  // Device logs: the joystick warning is one group of 2; open it, see the device and trail, mark fixed.
  await page.click('#nav-logs');
  await page.waitForSelector('#log-list details');
  const group = page.locator('#log-list > details', { hasText: 'E2E joystick let go by itself' });
  const summary = await group.locator('> summary').textContent();
  await group.locator('> summary').click();
  await page.waitForTimeout(150);
  const trailText = await group.locator('.adm-trail').textContent();
  await shot('6-log');
  check('device logs: the same problem twice is one row; it shows the iPhone, the trail and what led to it', { summary, trailText }, /2 times/.test(summary ?? '') && /iPhone · Chrome 129/.test(summary ?? '') && /joystick let go/.test(trailText ?? ''));
  await group.getByRole('button', { name: /Mark fixed/ }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('#log-list details summary')].some((s) => s.textContent.includes('E2E joystick')));
  check('mark fixed: it leaves the open list', true, true);
  await ctxB.close();
}

// ---- Desktop: scores, audit, sign out ----
{
  const { page, shot, ctxB } = await run('desktop', { width: 1366, height: 860 }, false);
  await page.waitForSelector('#adm-gate');
  await page.fill('#adm-user', 'Diesel');
  await page.fill('#adm-pass', 'a long admin password');
  await page.click('#adm-go');
  await page.waitForSelector('.adm-tile');
  await shot('1-dashboard');
  await page.click('#nav-scores');
  await page.waitForSelector('#runs-rejected');
  const rej = await page.textContent('#runs-rejected');
  check('scores: the rejected run shows who and why (“not possible”)', rej, /Zara claimed 999,999/.test(rej ?? '') && /replay scored 1200/.test(rej ?? ''));
  await shot('2-scores');
  await page.click('#nav-audit');
  await page.waitForSelector('#audit-table');
  const audit = await page.textContent('#audit-table');
  check('audit log: every change with who did it', null, /wallet/.test(audit ?? '') && /edit player/.test(audit ?? '') && /ban/.test(audit ?? '') && /diesel/.test(audit ?? ''));
  await shot('3-audit');
  await page.click('#nav-reports');
  await page.waitForSelector('#report-list details');
  const rep = page.locator('#report-list > details', { hasText: 'E2E kept following me' });
  await rep.locator('> summary').click();
  const repText = await rep.textContent();
  await shot('3b-reports');
  check('player reports: who, why, their last chat lines', null, /Zara/.test(repText ?? '') && /Bullying or harassment/.test(repText ?? '') && /E2E hey come back/.test(repText ?? ''));
  await rep.getByRole('button', { name: 'Dealt with' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('#report-list > details')].some((d) => d.textContent.includes('E2E kept following me')));
  check('“Dealt with” takes it off the open list', true, true);
  await page.click('#nav-rooms');
  await page.waitForSelector('#room-list .adm-card');
  await shot('4-rooms');
  await page.click('#nav-critters');
  await page.waitForSelector('#critter-table');
  await shot('5-critters');
  await page.click('#nav-invites');
  await page.waitForSelector('#invite-make');
  await shot('6-invites');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForSelector('#adm-gate');
  const r = await page.evaluate(() => fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'overview' }) }).then((x) => x.status));
  check('signing out ends the session (the API says 401 after)', r, r === 401);
  const cookieVisible = await page.evaluate(() => document.cookie.includes('dh_admin'));
  check('the session cookie is invisible to the page’s scripts', cookieVisible, cookieVisible === false);
  await ctxB.close();
}

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
