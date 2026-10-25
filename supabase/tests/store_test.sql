-- The shop (20261118_store.sql, STORE.md §5.4) on a local Postgres (supabase/tests/run.sh): buying with
-- coins and gems, the same buy twice, not enough money, prices read inside the buy, wearing only what you
-- own, the ledger always adding up to the wallet, and coins from playing under the daily caps.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;
create or replace function pg_temp.sign_in(who uuid, email text, anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claim.sub', who::text, false),
         set_config('request.jwt.claims', json_build_object('sub', who, 'email', email, 'is_anonymous', anon)::text, false);
$$;
create or replace function pg_temp.coins(who uuid) returns bigint language sql as $$ select coalesce((select coins from public.wallets where user_id = who), 0) $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'sam@members.diesel-house.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'sue@members.diesel-house.invalid') on conflict do nothing;
insert into auth.users (id, email, is_anonymous) values ('00000000-0000-0000-0000-0000000000c9', null, true) on conflict do nothing;
insert into public.allowed_emails (email) values ('sam@members.diesel-house.invalid'), ('sue@members.diesel-house.invalid') on conflict do nothing;
insert into public.profiles (id, display_name, character_index) values
  ('00000000-0000-0000-0000-0000000000c1', 'Sam', 0), ('00000000-0000-0000-0000-0000000000c2', 'Sue', 1) on conflict do nothing;
select id as rare1 from public.catalog_items where rarity = 'rare' order by sort limit 1 \gset
select id as rare2 from public.catalog_items where rarity = 'rare' order by sort offset 1 limit 1 \gset
select id as epic1 from public.catalog_items where rarity = 'epic' order by sort limit 1 \gset
set client_min_messages = notice;

-- ---- The catalogue and an empty wallet ----
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c1', 'sam@members.diesel-house.invalid');
select pg_temp.ok(jsonb_array_length(public.my_store() -> 'items') = 80 and (public.my_store() -> 'wallet' ->> 'coins')::int = 0, 'the shop lists the 80 characters that aren’t starters; Sam has 0 coins');
select pg_temp.ok((select bool_and(((i ->> 'coins') is null) <> ((i ->> 'gems') is null)) from jsonb_array_elements(public.my_store() -> 'items') i), 'every item has exactly one price');
select pg_temp.ok(public.buy_item('ninja.eggboy', 'key-sam-0001') ->> 'why' = 'Not enough coins: you need 2,000 more.', 'not enough coins: says how many more, nothing charged');
do $$ begin
  insert into public.inventory (user_id, item_id, source) values (auth.uid(), 'ninja.eggboy', 'gift');
  raise exception 'FAIL: wrote the inventory directly';
exception when insufficient_privilege then raise notice 'PASS: the inventory only changes through buy_item';
end $$;
do $$ begin
  update public.wallets set coins = 999999 where user_id = auth.uid();
  if found then raise exception 'FAIL: changed a wallet directly'; end if;
  raise notice 'PASS: wallets can’t be changed directly';
exception when insufficient_privilege then raise notice 'PASS: wallets can’t be changed directly';
end $$;
do $$ begin
  update public.profiles set character_key = 'ninja.eggboy' where id = auth.uid();
  raise exception 'FAIL: wore a character Sam doesn’t own';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: can’t wear a character you don’t own';
end $$;
reset role;

-- ---- Buying with coins: once, even when asked twice ----
select public.grant_currency('00000000-0000-0000-0000-0000000000c1', 'coins', 2500, 'test');
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c1', 'sam@members.diesel-house.invalid');
select pg_temp.ok((public.buy_item('ninja.eggboy', 'key-sam-0002') -> 'wallet' ->> 'coins')::int = 500, 'Sam buys Egg Boy for 2,000 coins: 500 left');
select pg_temp.ok((public.buy_item('ninja.eggboy', 'key-sam-0002') ->> 'repeat')::boolean and pg_temp.coins(auth.uid()) = 500, 'the same buy again (same key): the first answer, no second charge');
select pg_temp.ok(public.buy_item('ninja.eggboy', 'key-sam-0003') ->> 'why' = 'You already own it.', 'buying something you own: refused, nothing charged');
select pg_temp.ok(public.buy_item('ninja.egggirl', 'key-sam-0004') ->> 'why' = 'Not enough coins: you need 1,500 more.' and pg_temp.coins(auth.uid()) = 500, 'a second Common with 500 coins: not enough, nothing charged');
update public.profiles set character_key = 'ninja.eggboy' where id = auth.uid();
select pg_temp.ok((select character_key from public.profiles where id = auth.uid()) = 'ninja.eggboy', 'Sam wears the character he bought');
select pg_temp.ok(public.my_store() -> 'owned' ? 'ninja.eggboy', 'it shows as owned in the shop');
reset role;

-- ---- Gems: free ones first, then bought ones ----
select public.grant_currency('00000000-0000-0000-0000-0000000000c1', 'gems_free', 100, 'test');
select public.grant_currency('00000000-0000-0000-0000-0000000000c1', 'gems_paid', 500, 'test');
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c1', 'sam@members.diesel-house.invalid');
select public.buy_item(:'rare1', 'key-sam-0005');
reset role;
select pg_temp.ok((select gems_free = 0 and gems_paid = 200 from public.wallets where user_id = '00000000-0000-0000-0000-0000000000c1'), 'a 400-gem Rare spends the 100 free gems first, then 300 bought ones');

-- ---- The price is the one in the catalogue at the moment of buying ----
update public.catalog_items set price_coins = 300 where id = 'ninja.egggirl';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c1', 'sam@members.diesel-house.invalid');
select pg_temp.ok((public.buy_item('ninja.egggirl', 'key-sam-0006') -> 'wallet' ->> 'coins')::int = 200, 'a price changed before the buy: the new price is charged (300), not what the game showed');
reset role;
update public.catalog_items set price_coins = 2000 where id = 'ninja.egggirl';

-- ---- Gone from the shop, locked wallet, guests ----
update public.catalog_items set active = false where id = :'epic1';
select public.grant_currency('00000000-0000-0000-0000-0000000000c2', 'gems_paid', 2000, 'test');
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c2', 'sue@members.diesel-house.invalid');
select pg_temp.ok(public.buy_item(:'epic1', 'key-sue-0001') ->> 'why' like 'That item’s gone from the shop%', 'an item taken off sale: “gone from the shop”, nothing charged');
reset role;
update public.wallets set locked = true where user_id = '00000000-0000-0000-0000-0000000000c2';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c2', 'sue@members.diesel-house.invalid');
select pg_temp.ok(public.buy_item(:'rare2', 'key-sue-0002') ->> 'why' like 'Your gem balance is negative%', 'a locked wallet (after a refund) can’t buy');
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c9', null, true);
select pg_temp.ok(public.buy_item('ninja.eggboy', 'key-guest-001') ->> 'why' like 'Members can shop%', 'guests can look but not buy');
reset role;
update public.wallets set locked = false where user_id = '00000000-0000-0000-0000-0000000000c2';

-- ---- Coins from playing ----
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c2', 'sue@members.diesel-house.invalid'); -- Sue's own play (settings stay after reset role)
update public.profiles set last_visit_date = current_date, streak_days = 1 where id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c2') = 50, 'the day’s first visit pays 50 coins');
update public.profiles set streak_days = 2 where id = '00000000-0000-0000-0000-0000000000c2';
update public.profiles set last_visit_date = current_date where id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c2') = 50, 'the same day again: nothing more');
insert into public.xp_ledger (user_id, amount, reason) values ('00000000-0000-0000-0000-0000000000c2', 15, 'challenge:d_emotes');
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c2') = 90, 'a daily challenge pays 40 coins (its XP × 2, at least 40)');
insert into public.xp_ledger (user_id, amount, reason) values ('00000000-0000-0000-0000-0000000000c2', 150, 'challenge:w_rooms');
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c2') = 390, 'a weekly challenge pays 300');
insert into public.xp_ledger (user_id, amount, reason) values ('00000000-0000-0000-0000-0000000000c2', 5, 'catch:cat'), ('00000000-0000-0000-0000-0000000000c2', 15, 'catch:fox');
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c2') = 450, 'catches pay 10, a rare one 50');
insert into public.game_results (game, spot, host_id, players, winner_ids)
  values ('dice', 'hall', '00000000-0000-0000-0000-0000000000c2', array['00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1']::uuid[], array['00000000-0000-0000-0000-0000000000c2']::uuid[]);
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c2') = 470 and pg_temp.coins('00000000-0000-0000-0000-0000000000c1') = 205, 'a game: 20 for the winner, 5 for the other player');
insert into public.game_results (game, spot, host_id, players, winner_ids)
  select 'dice', 'hall', '00000000-0000-0000-0000-0000000000c2', array['00000000-0000-0000-0000-0000000000c2']::uuid[], array['00000000-0000-0000-0000-0000000000c2']::uuid[] from generate_series(1, 20);
select pg_temp.ok(public.coins_earned_today('00000000-0000-0000-0000-0000000000c2', 'game') = 200, 'games pay at most 200 a day');
insert into public.xp_ledger (user_id, amount, reason) select '00000000-0000-0000-0000-0000000000c2', 25, 'catch:medal' from generate_series(1, 30);
select pg_temp.ok(public.coins_earned_today('00000000-0000-0000-0000-0000000000c2') = 800, 'everything together stops at the 800-a-day cap');
insert into auth.users (id, email, is_anonymous) values ('00000000-0000-0000-0000-0000000000c8', null, true) on conflict do nothing;
insert into public.xp_ledger (user_id, amount, reason) values ('00000000-0000-0000-0000-0000000000c8', 15, 'catch:fox');
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c8') = 0, 'guests don’t earn coins');
update public.profiles set level = level + 1 where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c1') = 205, 'someone else changing Sam’s level (an admin) pays no coins');
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c1', 'sam@members.diesel-house.invalid');
update public.profiles set level = level + 1 where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.ok(pg_temp.coins('00000000-0000-0000-0000-0000000000c1') = 255, 'levelling up (his own play, to level 3) pays 50 (100 × level ÷ 10, at least 50)');

-- ---- The ledger always adds up to the wallet ----
select pg_temp.ok(not exists (
  select 1 from public.wallets w
  where w.coins <> coalesce((select sum(delta) from public.ledger l where l.user_id = w.user_id and l.currency = 'coins'), 0)
     or w.gems_free <> coalesce((select sum(delta) from public.ledger l where l.user_id = w.user_id and l.currency = 'gems_free'), 0)
     or w.gems_paid <> coalesce((select sum(delta) from public.ledger l where l.user_id = w.user_id and l.currency = 'gems_paid'), 0)
), 'every wallet equals the sum of its ledger rows (coins, free gems, bought gems)');

-- ---- The admin page's Shop section ----
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000c1', 'sam@members.diesel-house.invalid');
do $$ begin
  perform public.admin_shop('x');
  raise exception 'FAIL: a player opened the admin shop';
exception when insufficient_privilege then raise notice 'PASS: only the server opens the admin shop';
end $$;
reset role;
set role service_role;
create temp table shop_t as select public.admin_login('diesel', 'a brand new passphrase') ->> 'token' as token;
select pg_temp.ok(jsonb_array_length(public.admin_shop((select token from shop_t)) -> 'items') = 80, 'the admin sees all 80 shop items with prices and owners');
select pg_temp.ok((public.admin_shop_item((select token from shop_t), 'ninja.pig', null, 50, true) ->> 'ok')::boolean, 'the admin changes a price from coins to gems');
select pg_temp.ok(public.admin_shop_item((select token from shop_t), 'ninja.pig', null, null, true) ->> 'why' = 'Give it one price: coins or gems.', 'an item always has exactly one price');
select pg_temp.ok((public.admin_econ_set((select token from shop_t), 'coins_visit', 75) ->> 'ok')::boolean, 'the admin changes a coin rate (daily visit 75)');
select pg_temp.ok(public.econ('coins_visit') = 75, '... and the house uses the new rate');
select pg_temp.ok((public.admin_give_item((select token from shop_t), '00000000-0000-0000-0000-0000000000c2', 'ninja.vampire') ->> 'ok')::boolean, 'the admin gives Sue a character');
select pg_temp.ok(public.owns('00000000-0000-0000-0000-0000000000c2', 'ninja.vampire'), '... and she owns it');
reset role;
select pg_temp.ok(exists (select 1 from public.admin_audit where action = 'give item'), 'shop changes are in the audit log');
update public.economy_config set value = '50' where key = 'coins_visit';
update public.catalog_items set price_coins = 2000, price_gems = null where id = 'ninja.pig';
