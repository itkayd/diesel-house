// Dev-only test mode (`npm run dev`, open with ?test): skips the login and uses public Realtime
// channels, so the automated gameplay tests can run without real accounts. It does not exist in
// production builds (import.meta.env.DEV is false there), and stops working for Realtime once
// "Allow public access" is switched off in Supabase.
export const devTest = import.meta.env.DEV && new URLSearchParams(location.search).has('test');
