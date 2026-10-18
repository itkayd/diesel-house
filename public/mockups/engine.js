// The R2 look mock-ups (REDESIGN.md §5): plays one pre-built scene (design/redesign/mockups/build_*.py)
// with a character you can walk around. Keys: WASD / arrows. Phone: hold a finger where you want to go.
// The scene: scene.png (under you), front.png (furniture drawn over you when you're behind it), mask.png
// (white = floor you can walk on) and meta.json (lights, the disco floor and ball, door signs, characters).
// Plain script, no build step: these pages are only for choosing a look.

const SPEED = 70; // px per second, in scene pixels
const NIGHT = 'rgb(138,127,174)'; // multiplied over everything, as in the game
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });

export async function play(dir) {
  const meta = await (await fetch(`${dir}/meta.json`)).json();
  const [scene, front, maskImg, ball] = await Promise.all([
    load(`${dir}/scene.png`), load(`${dir}/front.png`).catch(() => null), load(`${dir}/mask.png`), meta.ball ? load(`${dir}/${meta.ball.src}`) : null,
  ]);
  const chars = await Promise.all(meta.characters.map(async (c) => ({ ...c, img: await load(`${dir}/${c.src}`) })));
  const [W, H] = meta.size;
  const m = document.createElement('canvas');
  m.width = W; m.height = H;
  const mctx = m.getContext('2d', { willReadFrequently: true });
  mctx.drawImage(maskImg, 0, 0);
  const mask = mctx.getImageData(0, 0, W, H).data;
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[(Math.floor(y) * W + Math.floor(x)) * 4] > 128;
  const feetFree = (x, y) => free(x - 4, y) && free(x + 4, y) && free(x - 4, y - 3) && free(x + 4, y - 3);

  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  let scale = 3;
  const fit = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    // Whole-number zoom so pixels stay sharp: about 20 x 14 tiles of 16 px on screen (fewer for big tiles).
    const t = meta.tile;
    scale = Math.max(1, Math.round(Math.min(canvas.width / (t * (t > 16 ? 13 : 20)), canvas.height / (t * (t > 16 ? 9 : 14)))));
    ctx.imageSmoothingEnabled = false;
  };
  fit();
  addEventListener('resize', fit);

  // You
  let ci = 0;
  let [px, py] = meta.spawn;
  let dir_ = 'down';
  let moving = false;
  let anim = 0;
  const keys = new Set();
  addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  let touch = null; // where the finger is, in scene pixels
  const toScene = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    const sx = ((cx - r.left) / r.width) * canvas.width;
    const sy = ((cy - r.top) / r.height) * canvas.height;
    return [cam.x + sx / scale, cam.y + sy / scale];
  };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); touch = toScene(e.clientX, e.clientY); });
  canvas.addEventListener('pointermove', (e) => { if (touch) touch = toScene(e.clientX, e.clientY); });
  const up = () => (touch = null);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  document.getElementById('swap')?.addEventListener('click', () => {
    ci = (ci + 1) % chars.length;
    document.getElementById('who').textContent = chars[ci].label;
  });
  const who = document.getElementById('who');
  if (who) who.textContent = chars[0].label;
  let lightsOn = true;
  document.getElementById('lights')?.addEventListener('click', (e) => {
    lightsOn = !lightsOn;
    e.currentTarget.textContent = lightsOn ? 'Night' : 'Day';
  });

  const cam = { x: 0, y: 0 };
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Input
    let vx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let vy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (touch) {
      const dx = touch[0] - px;
      const dy = touch[1] - (py - 6);
      const d = Math.hypot(dx, dy);
      if (d > 4) [vx, vy] = [dx / d, dy / d];
    }
    const len = Math.hypot(vx, vy);
    moving = len > 0.1;
    if (moving) {
      vx /= len; vy /= len;
      dir_ = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      const nx = px + vx * SPEED * dt;
      const ny = py + vy * SPEED * dt;
      if (feetFree(nx, py)) px = nx;
      if (feetFree(px, ny)) py = ny;
      anim += dt;
    } else anim = 0;

    // Camera follows you, kept inside the scene.
    const vw = canvas.width / scale;
    const vh = canvas.height / scale;
    cam.x = W <= vw ? (W - vw) / 2 : Math.max(0, Math.min(W - vw, px - vw / 2));
    cam.y = H <= vh ? (H - vh) / 2 : Math.max(0, Math.min(H - vh, py - vh / 2));
    const sx = (x) => Math.round((x - cam.x) * scale);
    const sy = (y) => Math.round((y - cam.y) * scale);

    ctx.fillStyle = '#140f1c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scene, sx(0), sy(0), W * scale, H * scale);

    // The dance floor: a slow, soft colour drift (no strobing).
    const t = now / 1000;
    if (meta.disco) {
      const d = meta.disco;
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      for (let j = 0; j < d.rows; j++)
        for (let i = 0; i < d.cols; i++) {
          const hue = (t * (reduce ? 6 : 30) + i * 40 + j * 70) % 360;
          ctx.fillStyle = `hsla(${hue},90%,60%,0.85)`;
          if (d.iso) {
            const [cx, cy] = [d.x + (i - j) * d.cell, d.y + (i + j) * d.cell / 2];
            ctx.beginPath();
            ctx.moveTo(sx(cx), sy(cy)); ctx.lineTo(sx(cx + d.cell), sy(cy + d.cell / 2)); ctx.lineTo(sx(cx), sy(cy + d.cell)); ctx.lineTo(sx(cx - d.cell), sy(cy + d.cell / 2));
            ctx.fill();
          } else ctx.fillRect(sx(d.x + i * d.cell), sy(d.y + j * d.cell), d.cell * scale, d.cell * scale);
        }
      ctx.restore();
    }

    // You, with the furniture you're behind drawn over you again.
    const c = chars[ci];
    const frames = moving ? c.walk[dir_] : c.idle[dir_];
    const [fx, fy] = frames[Math.floor(anim * c.fps) % frames.length];
    const cs = c.scale;
    const dw = c.fw * cs;
    const dh = c.fh * cs;
    const left = px - c.feet[0] * cs;
    const top = py - c.feet[1] * cs;
    ctx.fillStyle = 'rgba(13,9,18,0.35)';
    ctx.beginPath();
    ctx.ellipse(sx(px), sy(py), 5 * cs * scale, 2 * cs * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(c.img, fx, fy, c.fw, c.fh, sx(left), sy(top), dw * scale, dh * scale);
    if (front)
      for (const [x, y, w, h] of meta.solids) {
        if (y + h <= py || x > left + dw || x + w < left || y > top + dh || y + h < top) continue;
        ctx.drawImage(front, x, y, w, h, sx(x), sy(y), w * scale, h * scale);
      }

    // Night: tint everything, then warm light back in.
    if (lightsOn) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = NIGHT;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      for (const l of meta.lights) {
        const flick = reduce ? 1 : l.disco ? 0.75 + 0.25 * Math.sin(t * 1.3) : 0.92 + 0.08 * Math.sin(t * 2 + l.x);
        const r = l.r * scale;
        const g = ctx.createRadialGradient(sx(l.x), sy(l.y), 0, sx(l.x), sy(l.y), r);
        const col = l.disco ? `hsla(${(t * 20) % 360},80%,60%,` : l.c;
        g.addColorStop(0, l.disco ? col + `${0.28 * flick})` : hexA(col, 0.32 * flick));
        g.addColorStop(1, l.disco ? col + '0)' : hexA(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(sx(l.x) - r, sy(l.y) - r, r * 2, r * 2);
      }
      ctx.restore();
    }

    // The glitter ball and its light specks sweeping the room.
    if (meta.ball && ball) {
      const b = meta.ball;
      const bob = reduce ? 0 : Math.sin(t * 1.5) * 1;
      ctx.drawImage(ball, sx(b.x - b.size / 2), sy(b.y - b.size / 2 + bob), b.size * scale, b.size * scale);
      if (meta.disco) {
        const d = meta.disco;
        const cx = d.iso ? d.x : d.x + (d.cols * d.cell) / 2;
        const cy = d.iso ? d.y + ((d.cols + d.rows) * d.cell) / 4 : d.y + (d.rows * d.cell) / 2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 14; k++) {
          const a = k * 2.4 + t * (reduce ? 0.05 : 0.35);
          const rr = 18 + ((k * 37) % 70);
          const x = cx + Math.cos(a) * rr * 1.2;
          const y = cy + Math.sin(a) * rr * 0.6;
          ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.25 * Math.sin(t * 2 + k)})`;
          ctx.fillRect(sx(x), sy(y), 2 * scale, 2 * scale);
        }
        ctx.restore();
      }
    }

    // Door signs.
    ctx.textBaseline = 'middle';
    for (const s of meta.signs) {
      const fs = (s.small ? 6 : 7) * (meta.tile > 16 ? 1.6 : 1);
      ctx.font = `${fs * scale}px "Pixelify Sans", monospace`;
      const w = ctx.measureText(s.text).width + 8 * scale;
      const h = (fs + 5) * scale;
      const x = sx(s.x) - w / 2;
      const y = sy(s.y);
      ctx.fillStyle = '#0d0912';
      ctx.fillRect(x - scale, y - scale, w + 2 * scale, h + 2 * scale);
      ctx.fillStyle = s.small ? '#4a3a57' : '#7a4b31';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#9a6440';
      if (!s.small) ctx.fillRect(x, y, w, scale);
      ctx.fillStyle = '#fff4e0';
      ctx.fillText(s.text, x + 4 * scale, y + h / 2 + scale / 2);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.mock = { get x() { return px; }, get y() { return py; }, get dir() { return dir_; } }; // for automated checks
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Pages say which scene they show: <body data-mock="a">.
if (document.body.dataset.mock) void play(document.body.dataset.mock);
