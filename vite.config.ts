import { defineConfig, loadEnv, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Runs api/turn.ts during `npm run dev` (Vercel runs it in production).
// Until logins exist (Phase 5), requests from this computer may skip the sign-in check.
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/turn', async (req, res) => {
        try {
          const { handleTurn } = await server.ssrLoadModule('/api/turn.ts');
          const ip = req.socket.remoteAddress ?? '';
          const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const response: Response = await handleTurn(new Request(`http://localhost${req.url}`, { headers }), env, {
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
  };
});
