import { defineConfig, loadEnv, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import vercel from './vercel.json';
import { existsSync, readdirSync } from 'node:fs';

// Runs the Vercel functions in api/ during `npm run dev` (Vercel runs them in production).
// /api/turn requests from this computer may skip the sign-in check (used by the voice tests).
const API: Record<string, string> = { turn: 'handleTurn', ping: 'handle', admin: 'handle', join: 'handle', arcade: 'handle' }; // file -> exported handler

function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!API[name]) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const ip = req.socket.remoteAddress ?? '';
          const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const method = req.method ?? 'GET';
          let body: Buffer | undefined;
          if (method !== 'GET' && method !== 'HEAD') {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            body = Buffer.concat(chunks);
          }
          const request = new Request(`http://${req.headers.host ?? 'localhost'}/api${req.url}`, { method, headers, body: body ? new Uint8Array(body) : undefined });
          const response: Response = await mod[API[name]](request, env, {
            allowAnonymous: local,
          });
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(await response.text());
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // server-side only; never sent to the browser
  return {
    // `npm run dev:https` serves over https so phones on the Wi-Fi can use the microphone.
    plugins: [devApi(env), ...(mode === 'https' ? [basicSsl()] : [])],
    // Which sound effects exist (src/ui/sounds.ts only loads these). Restart the dev server after adding one.
    define: { __SFX_FILES__: JSON.stringify(existsSync('public/assets/sfx') ? readdirSync('public/assets/sfx') : []) },
    server: { host: true }, // reachable from a phone on the same Wi-Fi
    // `npm run build && npx vite preview` serves the built site with the same security headers as Vercel.
    preview: { headers: Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value])) },
    // Two pages: the game, and Diesel's door list (admin.html). The login screen (main) loads first and small;
    // the game (src/game.ts) follows while you sign in, with Phaser (~1.2 MB) in a file of its own that
    // rarely changes, so phones keep it between updates. Voice loads after the picker.
    build: {
      chunkSizeWarningLimit: 1300,
      rollupOptions: {
        input: { main: 'index.html', admin: 'admin.html' },
        output: { manualChunks: (id: string) => (id.includes('/node_modules/phaser/') ? 'phaser' : undefined) },
      },
    },
  };
});
