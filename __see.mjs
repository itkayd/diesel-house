import { chromium } from 'playwright-core';
const URL = process.env.U;
const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function signIn(name, pw) {
  const ctx = await b.newContext({ permissions: ['microphone'] });
  const p = await ctx.newPage();
  const log = [];
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.push(m.type() + ': ' + m.text().slice(0, 200)));
  p.on('websocket', (ws) => { ws.on('framesent', (f) => { const s = String(f.payload); if (/broadcast/.test(s)) log.push('ws> ' + s.slice(0, 200)); }); ws.on('framereceived', (f) => { const s = String(f.payload); if (/house/.test(s) && !/presence_state|presence_diff/.test(s)) log.push('ws< ' + s.slice(0, 300)); }); });
  await p.goto(URL);
  await p.waitForSelector('#si-name');
  await p.fill('#si-name', name); await p.fill('#si-pass', pw); await p.click('#signin .knock');
  await p.waitForSelector('#status', { timeout: 20000 }).catch(() => {});
  return { name, p, log };
}
const A = await signIn('Tester', process.env.PA);
const B = await signIn('Visitor', process.env.PB);
await A.p.waitForTimeout(3000);
await A.p.keyboard.down('ArrowRight'); await A.p.waitForTimeout(1500); await A.p.keyboard.up('ArrowRight');
await B.p.waitForTimeout(1500);
await B.p.screenshot({ path: process.env.SHOT });
await A.p.waitForTimeout(3000);
for (const x of [A, B]) {
  const pill = await x.p.evaluate(() => [document.getElementById('where')?.textContent, document.getElementById('status')?.textContent].join(' | ')).catch((e) => e.message);
  console.log(`== ${x.name}: ${pill}`);
  console.log(x.log.filter(l=>!/404/.test(l)).slice(0, 14).join('\n'));
}
await b.close();
