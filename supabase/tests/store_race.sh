#!/usr/bin/env sh
# STORE.md §5.4: two buys at the same moment. Run after run.sh (uses its dh_test database and Sue from
# store_test.sql). Sue gets exactly 2,000 coins and two copies of the game try to buy two different Common
# characters at once: exactly one succeeds. Then two buys with the SAME key at once: charged once.
set -e
q() { psql -v ON_ERROR_STOP=1 -qtA -d dh_test -c "$1"; }
as_sue="set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false), set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-0000000000c2\",\"email\":\"sue@members.diesel-house.invalid\"}', false);"
coins=$(q "select coins from public.wallets where user_id = '00000000-0000-0000-0000-0000000000c2'")
q "select public.grant_currency('00000000-0000-0000-0000-0000000000c2', 'coins', 2000 - $coins, 'race test')" >/dev/null
a=$(mktemp); b=$(mktemp)
psql -qtA -d dh_test -c "$as_sue select public.buy_item('ninja.cavegirl', 'race-key-aaaa') ->> 'ok';" > "$a" 2>&1 &
psql -qtA -d dh_test -c "$as_sue select public.buy_item('ninja.cavegirl2', 'race-key-bbbb') ->> 'ok';" > "$b" 2>&1 &
wait
ok=$(cat "$a" "$b" | grep -c '^true$' || true)
left=$(q "select coins from public.wallets where user_id = '00000000-0000-0000-0000-0000000000c2'")
[ "$ok" = 1 ] && [ "$left" = 0 ] && echo "PASS  two different buys at once with money for one: exactly one goes through ($ok ok, $left coins left)" || echo "FAIL  race: $ok succeeded, $left coins left"
q "select public.grant_currency('00000000-0000-0000-0000-0000000000c2', 'coins', 2000, 'race test 2')" >/dev/null
psql -qtA -d dh_test -c "$as_sue select public.buy_item('ninja.caveman', 'race-key-same') ->> 'ok';" > "$a" 2>&1 &
psql -qtA -d dh_test -c "$as_sue select public.buy_item('ninja.caveman', 'race-key-same') ->> 'ok';" > "$b" 2>&1 &
wait
left=$(q "select coins from public.wallets where user_id = '00000000-0000-0000-0000-0000000000c2'")
[ "$left" = 0 ] && echo "PASS  the same buy twice at once (same key): charged once ($left coins left)" || echo "FAIL  same-key race: $left coins left; $(cat "$a" "$b" | tr '\n' ' ')"
rm -f "$a" "$b"
