import { defineConfig, loadEnv, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Runs the Vercel functions in api/ during `npm run dev` (Vercel runs them in production).
// Until logins exist (Phase 5), /api/turn requests from this computer may skip the sign-in check.
const API: Record<string, string> = { turn: 'handleTurn', ping: 'handle', admin: 'handle', join: 'handle' }; // file -> exported handler

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
    server: { host: true }, // reachable from a phone on the same Wi-Fi
    // Phaser alone is ~1.2 MB and can't be split; Supabase and voice already load separately after the picker.
    // Two pages: the game, and Diesel's door list (admin.html).
    build: { chunkSizeWarningLimit: 1300, rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
  };
});
