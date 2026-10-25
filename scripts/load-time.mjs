// How long until the house is playable (you can walk), on a phone-like CPU and a 4G connection.
// Run against a production build: npm run build && npx vite preview --port 4173, then
//   DH_CHROMIUM=/opt/pw-browsers/chromium node scripts/load-time.mjs [url]
// (Without .env the build skips the login, so this times the game itself.) Prints each run and the median.
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const NETS = {
  '4G': { latency: 70, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  'slow 4G': { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};
for (const [name, net] of Object.entries(NETS)) {
  const times = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      localStorage.setItem('diesel-house.name', 'Timer');
      localStorage.setItem('diesel-house.character', 'ninja.villager2');
      localStorage.setItem('diesel-house.guide-seen', '1');
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.goto(url);
    // Playable: the house is drawn and you can walk (or the character picker is up, on a first visit).
    await page.waitForFunction(() => document.querySelector('#picker') || (document.querySelector('#overlay .dh-hud') && document.querySelector('canvas')), null, { timeout: 60000 });
    times.push(Date.now() - t0);
    await ctx.close();
  }
  times.sort((a, b) => a - b);
  console.log(`${name}: ${times.map((t) => (t / 1000).toFixed(1) + ' s').join(', ')}  (median ${(times[1] / 1000).toFixed(1)} s)`);
}
await browser.close();
