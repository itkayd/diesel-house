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
1. **First remove the test members** Tester and Visitor on the door list (**Remove** next to each). The house allows 8 accounts in total, so they'd take two places.
2. Open `https://<your-site>/admin.html`, type your `ADMIN_PASSCODE`.
3. Under **Add codes you already have**, paste your 8 codes, one per line, with who each is for: `Sami: ABCD-1234`. (Or tap **Make an invite code** to have one made for you.)
4. Send each friend their code. They open the site → **Join the house** → code, name, password. The code then belongs to them and stops working for anyone else; from then on they sign in with name + password on any device.
5. On a phone: Share → **Add to Home Screen** (iPhone) or ⋮ → **Install app** (Android) and it opens full-screen like an app.

Guests: each friend has their own guest code in **Settings → Your guests**. Guests can't make an account or invite anyone, choose from two characters (Adam or Amelia), show as "friend of …", and can talk and chat in rooms whose door lets them in.

## Checking a build on your computer first
```powershell
npm run build
npx vite preview --port 4173
```
Then open http://localhost:4173. This uses the same security headers as Vercel. `tests/e2e/deploy.mjs` checks it automatically.
