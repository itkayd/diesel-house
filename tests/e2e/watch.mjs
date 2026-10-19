import { chromium } from 'playwright-core';
// Watch & listen together: links are read right, the TV button shows only in the Lounge / Disco, a pasted
// link plays, pause / skip / stop act on the room, a screen that drifts is pulled back in step, and
// another person's change (arriving from the database) is followed. Dev test mode with a stand-in player
// (?fakemedia: no YouTube in tests); the room changes go through roomChanged as the database would send them.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Viewer');
  localStorage.setItem('diesel-house.character', 'ninja.woman');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test&fakemedia');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove && window.__house.watch, null, { timeout: 30000 });

// 1. Links.
const parsed = await page.evaluate(() =>
  import('/src/house/media.ts').then((m) =>
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
      'https://youtu.be/dQw4w9WgXcQ?t=1m5s',
      'youtube.com/shorts/abcdefghijk',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x',
      'https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M',
      'spotify:album:4aawyAB9vmqN3uQ7FjRGTy',
      'https://example.com/video',
    ].map((s) => ({ s, m: m.parseMediaLink(s), t: m.linkStart(s) })),
  ),
);
check('YouTube (watch, youtu.be, Shorts, Music) and Spotify (track, playlist, album) links are read; others refused', parsed.map((p) => (p.m ? `${p.m.kind}:${p.m.id}@${p.t}` : null)),
  JSON.stringify(parsed.map((p) => (p.m ? `${p.m.kind}:${p.m.id}@${p.t}` : null))) === JSON.stringify(['youtube:dQw4w9WgXcQ@42', 'youtube:dQw4w9WgXcQ@65', 'youtube:abcdefghijk@0', 'youtube:dQw4w9WgXcQ@0', 'spotify:track:4cOdK2wGLETKBW3PvgPWqT@0', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M@0', 'spotify:album:4aawyAB9vmqN3uQ7FjRGTy@0', null]));

// The database answers "set_room_media" for this test: apply it the way the live update would.
await page.evaluate(() => {
  const h = window.__house;
  window.__sets = [];
  h.watch.deps.set = async (m) => {
    window.__sets.push(m);
    const room = h.zone;
    h.roomChanged({ ...h.rooms.get(room), id: room, media_kind: m?.kind ?? null, media_id: m?.id ?? null, media_pos: m?.pos ?? null, media_at: m ? new Date().toISOString() : null, media_paused: m?.paused ?? false, media_by: m ? h.presence?.id ?? null : null });
    return null;
  };
});

// 2. Button only in the Lounge.
const hall = await page.locator('#watch-button').isVisible();
await page.evaluate(() => window.__house.walkToRoom('lounge'));
await page.waitForFunction(() => window.__house.zone === 'lounge', null, { timeout: 20000 });
await page.waitForTimeout(400);
check('the TV button shows in the Lounge, not in the Great Hall', { hall, lounge: await page.locator('#watch-button').isVisible() }, !hall && (await page.locator('#watch-button').isVisible()));

// 3. Paste a link: it plays (muted, with "Tap for sound").
await page.tap('#watch-button');
await page.fill('#watch-link', 'nonsense');
await page.tap('#watch-go');
const bad = await page.locator('#watch-error').isVisible();
await page.fill('#watch-link', 'https://youtu.be/dQw4w9WgXcQ?t=30');
await page.tap('#watch-go');
await page.waitForTimeout(500);
const on = await page.evaluate(() => { const p = window.__house.watch.playerForTests; return { loaded: p?.loaded, t: Math.round(p?.time() ?? -1), paused: p?.paused, screen: !document.getElementById('screen').hidden, sound: !document.getElementById('screen-sound').hidden }; });
check('a bad link is refused; a good one plays from its start time, muted with "Tap for sound"', { bad, on }, bad && on.loaded?.id === 'dQw4w9WgXcQ' && on.t >= 30 && on.t <= 32 && !on.paused && on.screen && on.sound);
await page.tap('#screen-sound');
check('"Tap for sound" turns sound on (for you)', {}, (await page.evaluate(() => window.__house.watch.playerForTests.muted)) === false && (await page.locator('#screen-sound').isHidden()));

// 4. Pause, then forward 10 s: for everyone (room state), and this screen follows.
await page.tap('#screen-play');
await page.waitForTimeout(300);
const paused = await page.evaluate(() => ({ room: window.__house.rooms.get('lounge').media_paused, player: window.__house.watch.playerForTests.paused }));
await page.waitForTimeout(700);
await page.tap('#screen-fwd');
await page.waitForTimeout(300);
const fwd = await page.evaluate(() => ({ pos: Math.round(window.__house.rooms.get('lounge').media_pos), t: Math.round(window.__house.watch.playerForTests.time()) }));
check('pause and forward 10 s change it for the room, and the screen follows', { paused, fwd }, paused.room && paused.player && fwd.pos >= 40 && fwd.pos <= 43 && Math.abs(fwd.t - fwd.pos) <= 1);

// 5. Someone else plays it from 2:00: we follow. A screen that drifts gets pulled back.
await page.evaluate(() => { const h = window.__house; h.roomChanged({ ...h.rooms.get('lounge'), media_pos: 120, media_paused: false, media_at: new Date().toISOString(), media_by: 'someone-else' }); });
await page.waitForTimeout(300);
await page.evaluate(() => window.__house.watch.playerForTests.seek(10)); // fell behind
await page.waitForTimeout(2600);
const caught = await page.evaluate(() => Math.round(window.__house.watch.playerForTests.time()));
check('another person’s change is followed, and a screen that falls behind catches up', { caught }, caught >= 120 && caught <= 126);

// 6. Hide (just for you), show again; stop for everyone; leave the room.
await page.tap('#screen-hide');
const hidden = { screen: await page.locator('#screen').isHidden(), chip: await page.locator('#screen-chip').isVisible() };
await page.tap('#screen-chip');
await page.tap('#screen-stop');
await page.waitForTimeout(300);
const stopped = await page.evaluate(() => ({ room: window.__house.rooms.get('lounge').media_kind, screen: document.getElementById('screen').hidden }));
check('Hide tucks it into a chip (for you); Stop clears it for the room', { hidden, stopped }, hidden.screen && hidden.chip && stopped.room === null && stopped.screen);

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
