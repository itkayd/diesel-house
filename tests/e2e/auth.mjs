import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Phase 5 front door and lock-down. Needs `npm run dev`. Sends no emails.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];

// 1. Without a session the login screen (design/login/login.html) is the front door; no game yet.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForSelector('#login-screen', { timeout: 15000 }).catch(() => {});
const login = await page.evaluate(() => ({
  shown: !!document.getElementById('login-screen'),
  title: document.querySelector('#login-screen h1')?.textContent,
  tagline: document.querySelector('#login-screen .sign p')?.textContent,
  card: document.querySelector('#login-screen #signin h2')?.textContent,
  button: document.querySelector('#login-screen #signin .knock')?.textContent,
  gameStarted: !!window.__house,
}));
check('no session: the login screen shows, the game does not start', login,
  login.shown && login.title === 'Diesel House' && login.card === 'Knock to come in' && login.button === 'Knock on the door' && !login.gameStarted);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/auth_login_phone.png` });
const errorOf = (form) => page.locator(`#${form} .error`).textContent();

// 2. Members: a wrong name/password is turned away kindly.
await page.fill('#si-name', 'Nobody Here');
await page.fill('#si-pass', 'not-the-password');
await page.click('#signin .knock');
await page.waitForSelector('#signin .error:not([hidden])', { timeout: 10000 }).catch(() => {});
const memberErr = await errorOf('signin');
check('wrong name or password: friendly message, still at the door', { memberErr }, /don't match/.test(memberErr ?? '') && !(await page.evaluate(() => !!window.__house)));

// 3. Joining needs a real invite code from Diesel.
await page.click('#signin [data-go="join"]');
await page.fill('#jn-code', 'ZZZZ-ZZZZ');
await page.fill('#jn-name', 'Test Person');
await page.fill('#jn-pass', 'long-enough-pass');
await page.click('#join .knock');
await page.waitForSelector('#join .error:not([hidden])', { timeout: 10000 }).catch(() => {});
const joinErr = await errorOf('join');
check('join with a made-up code: refused', { joinErr }, /doesn't work|switched off/.test(joinErr ?? ''));

// 4. Guests need a friend's invite code (or an open house).
await page.click('#join [data-go="signin"]');
await page.click('#signin [data-go="guest"]');
await page.fill('#gs-code', 'ZZZZ-ZZZZ');
await page.click('#guest .knock');
await page.waitForSelector('#guest .error:not([hidden])', { timeout: 10000 }).catch(() => {});
const guestErr = await errorOf('guest');
check('guest with a made-up code: refused, no way in', { guestErr }, /doesn't work|switched off|need an invite code/.test(guestErr ?? '') && !(await page.evaluate(() => !!window.__house)));
// 5. Diesel's door list is passcode-locked (wrong passcode, or not set up yet, either way: no list).
const admin = await browser.newPage();
await admin.goto('http://localhost:5173/admin.html');
await admin.waitForSelector('#passcode');
await admin.fill('#passcode', 'definitely-not-it');
await admin.click('#lock button');
await admin.waitForSelector('#lock .dh-error:not([hidden])', { timeout: 8000 }).catch(() => {});
const lockMsg = await admin.locator('#lock .dh-error').textContent().catch(() => null);
const listed = await admin.locator('[data-member], [data-code]').count();
check('door list: a wrong passcode shows nothing', { lockMsg, listed }, listed === 0 && /Wrong passcode|Set ADMIN_PASSCODE/.test(lockMsg ?? ''));
await browser.close();

// 6. A client holding only the publishable key (no login) cannot join the private channels.
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
async function tryJoin(topic) {
  return new Promise((resolve) => {
    const ch = anon.channel(topic, { config: { private: true } });
    let got = 0;
    ch.on('broadcast', { event: '*' }, () => got++);
    const timer = setTimeout(() => resolve({ status: 'no answer', got }), 10000);
    ch.subscribe((status, e) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve({ status, reason: e?.message?.slice(0, 120), got });
        void anon.removeChannel(ch);
      }
    });
  });
}
const house = await tryJoin('house');
const voice = await tryJoin('voice:room_01');
check('no login: refused on the private "house" channel', house, house.status !== 'SUBSCRIBED');
check('no login: refused on a private voice room channel', voice, voice.status !== 'SUBSCRIBED');
await anon.removeAllChannels();

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
process.exit();
