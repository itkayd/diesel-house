# Putting Diesel House online (Vercel)

About 15 minutes. You need: your GitHub login, your Twilio console, and your Supabase dashboard.

## 1. Supabase (dashboard → project `diesel-house`)
1. **Authentication → Sign In / Providers → Allow anonymous sign-ins: ON** (guests use this).
2. **Project Settings → API Keys** → copy the **service_role / secret** key. You'll paste it into Vercel below. Never put it anywhere else.
3. **Realtime → Settings → Allow public access: OFF** (only signed-in people can use the live channels).
4. After step 3 of Vercel (you'll have the URL): **Authentication → URL Configuration → Site URL** = your Vercel URL, e.g. `https://diesel-house.vercel.app`.

## 2. Twilio (recommended: an API key instead of the main token)
Console → **Account → API keys & tokens → Create API key** (type: Standard). Copy the **SID** (starts `SK…`) and the **Secret** (shown once).

## 3. Vercel
1. https://vercel.com/new → **Import** the GitHub repo `itkayd/diesel-house` (keep it private).
2. Framework preset: **Vite** (build `npm run build`, output `dist`). These are detected automatically.
3. **Environment Variables**: add these before pressing Deploy:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://adnpeaytzgelqxuvpdyf.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_Nc4Gqi7dfIN4TqFyNHxFpA_vYzgQjW7` |
| `SUPABASE_URL` | `https://adnpeaytzgelqxuvpdyf.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key from Supabase step 2 |
| `TWILIO_ACCOUNT_SID` | your Twilio Account SID (`AC…`) |
| `TWILIO_API_KEY_SID` | the API key SID (`SK…`) |
| `TWILIO_API_KEY_SECRET` | the API key secret |
| `ADMIN_PASSCODE` | a passcode only you know (8+ characters) for the door list |
| `CRON_SECRET` | any long random text (protects the daily keep-awake ping) |

(`TWILIO_AUTH_TOKEN` also works instead of the API key pair, but the API key can be cancelled on its own if it ever leaks.)

4. **Deploy**. Every push to GitHub redeploys automatically.

## 4. Let your friends in
1. Open `https://<your-site>/admin.html`, type your `ADMIN_PASSCODE`.
2. **Make an invite code** for each friend; send it to them however you like.
3. They open the site → **I have an invite** → code, name, password. From then on they sign in with name + password on any device.
4. On a phone: Share → **Add to Home Screen** (iPhone) or ⋮ → **Install app** (Android) and it opens full-screen like an app.

## 5. Tidy up the test accounts
Two test members, **Tester** and **Visitor**, were made while building. Remove them on the door list (**Remove** next to each), which frees Room 1 too.

## Checking a build on your computer first
```powershell
npm run build
npx vite preview --port 4173
```
Then open http://localhost:4173. This uses the same security headers as Vercel. `tests/e2e/deploy.mjs` checks it automatically.
