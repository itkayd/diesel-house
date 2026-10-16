// Who's in the real house right now (names, rooms), without appearing in it: subscribes to the house
// channel but never tracks presence or sends anything. Used before running tests that sign in for real.
//   $env:DH_TEST_OWNER="Name:password"; node scripts/peek-house.mjs
import { createClient } from '@supabase/supabase-js';
import { memberLogin } from '../src/shared/members.ts';
const [name, password] = (process.env.DH_TEST_OWNER ?? '').split(':');
if (!password) { console.log('set DH_TEST_OWNER="Name:password"'); process.exit(1); }
const sb = createClient('https://adnpeaytzgelqxuvpdyf.supabase.co', 'sb_publishable_Nc4Gqi7dfIN4TqFyNHxFpA_vYzgQjW7', { auth: { persistSession: false } });
const { data, error } = await sb.auth.signInWithPassword({ email: memberLogin(name), password });
if (error) { console.log(error.message); process.exit(1); }
await sb.realtime.setAuth(data.session.access_token);
const ch = sb.channel('house', { config: { private: true } });
ch.on('presence', { event: 'sync' }, () => {});
await new Promise((r) => ch.subscribe((s) => s === 'SUBSCRIBED' && r()));
await new Promise((r) => setTimeout(r, 2500));
const people = Object.values(ch.presenceState()).flat().map((m) => `${m.name} (${m.zone ?? '?'})`);
console.log(people.length ? `${people.length} in the house: ${people.join(', ')}` : 'Nobody in the house');
await sb.removeChannel(ch);
await sb.auth.signOut({ scope: 'local' });
process.exit(0);
