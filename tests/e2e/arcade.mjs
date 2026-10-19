import { chromium } from 'playwright-core';
// Night Raid (the arcade): the game engine plays fair (a scripted player clears waves; scores stay under
// what the database accepts as believable), the boss comes on wave 5, hits cost lives and the game ends;
// the cabinet in the Gaming room and Games → Arcade open it; Escape pauses; game over shows the result.
// Dev test mode (scores aren't saved).
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Gamer');
  localStorage.setItem('diesel-house.character', 'ninja.villager2');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });

// 1. The engine: a simple player (chase the nearest spook, step away from fireballs) for 3 minutes.
const sim = await page.evaluate(() =>
  import('/src/games/nightRaidGame.ts').then(({ NightRaid, H }) => {
    const out = [];
    for (const seed of [1, 2, 3]) {
      const g = new NightRaid(seed);
      let t = 0;
      while (!g.over && t < 180) {
        const near = g.fire.find((f) => f.y > H - 90 && Math.abs(f.x - g.x) < 12);
        const target = near ? g.x + (near.x < g.x ? 30 : -30) : g.boss ? g.boss.x : g.enemies.reduce((b, e) => (!b || e.y > b.y ? e : b), null)?.x ?? g.x;
        g.step(1 / 60, { left: false, right: false, targetX: target });
        t += 1 / 60;
      }
      out.push({ seed, score: g.score, waves: g.wave, time: Math.round(g.time), over: g.over, believable: g.score <= Math.floor(g.time) * 150 + 1000 && g.wave <= Math.floor((g.time * 1000) / 5000) + 1 });
    }
    return out;
  }),
);
check('a scripted player clears waves and scores; every score is one the database calls believable', sim, sim.every((s) => s.believable) && sim.some((s) => s.waves >= 2) && sim.every((s) => s.score > 0));

// 2. Wave 5 is the Giant Spirit; hits cost lives; the game ends.
const rules = await page.evaluate(() =>
  import('/src/games/nightRaidGame.ts').then(({ NightRaid, H }) => {
    const events = [];
    const g = new NightRaid(7, (e) => events.push(e));
    g.wave = 3;
    g.enemies = [];
    g.step(0.016, { left: false, right: false, targetX: null });
    const boss = !!g.boss && g.waveNumber === 5;
    const lives0 = g.lives;
    g.hurt = 0;
    g.fire.push({ x: g.x, y: H - 30, vx: 0, vy: 0, magic: false });
    g.step(0.016, { left: false, right: false, targetX: null });
    const lost = lives0 - g.lives;
    g.lives = 1;
    g.hurt = 0;
    g.fire.push({ x: g.x, y: H - 30, vx: 0, vy: 0, magic: false });
    g.step(0.016, { left: false, right: false, targetX: null });
    return { boss, lost, over: g.over, events: [...new Set(events)] };
  }),
);
check('wave 5 brings the Giant Spirit; a fireball costs a life; the last life ends the game', rules, rules.boss && rules.lost === 1 && rules.over && rules.events.includes('boss') && rules.events.includes('over'));

// 3. The cabinet: stand in front of one in the Gaming room.
const spot = await page.evaluate(() => import('/src/house/arcade.ts').then((m) => m.ARCADE_SPOTS[0]));
await page.evaluate(({ x, y }) => { const h = window.__house; h.body.reset(x, y); h.player.setPosition(x, y); }, spot);
const prompt = await page.waitForSelector('#arcade-prompt', { timeout: 5000 }).then(() => true, () => false);
await page.tap('#arcade-prompt');
await page.waitForSelector('#arcade-play', { timeout: 5000 });
check('in front of a Gaming room arcade cabinet: "Play Night Raid" opens the title card', { spot, prompt }, prompt);

// 4. Play: the game runs; Escape pauses it.
await page.tap('#arcade-play');
await page.waitForSelector('#arcade-canvas');
await page.waitForTimeout(2500);
const running = await page.evaluate(() => window.__house.canMove);
const box = await page.locator('#arcade-canvas').boundingBox();
await page.keyboard.press('Escape');
const pausedLabel = await page.locator('#arcade-pause').getAttribute('aria-label');
const stillOpen = await page.locator('#arcade').count();
check('the game fills the screen; Escape pauses it (the card stays open); you can’t walk meanwhile', { box, pausedLabel, stillOpen, canMove: running }, box && box.width >= 300 && pausedLabel === 'Resume' && stillOpen === 1 && running === false);

// 5. Resume, close: you can walk again.
await page.tap('#arcade-pause');
const resumed = await page.locator('#arcade-pause').getAttribute('aria-label');
await page.tap('#arcade-close');
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({ open: !!document.getElementById('arcade'), canMove: window.__house.canMove }));
check('resume, then close: you can walk again', { resumed, after }, resumed === 'Pause' && !after.open && after.canMove);

// 6. Games → Arcade opens it too.
await page.evaluate(() => { const h = window.__house; h.body.reset(723, 525); h.player.setPosition(723, 525); });
await page.waitForSelector('#game-prompt', { timeout: 5000 });
await page.tap('#game-prompt');
await page.tap('#games-arcade');
const fromMenu = await page.waitForSelector('#arcade-play', { timeout: 5000 }).then(() => true, () => false);
check('Games → Night Raid (arcade) opens it from any games table', { fromMenu }, fromMenu);

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
