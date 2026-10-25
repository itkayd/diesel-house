-- STORE.md phase S2: the shop (coins first; gem packs with real money come in S3).
--  economy_config  earn rates and caps in one place (never hard-coded in the game)
--  catalog_items   what the shop sells, with ONE price: coins or gems (the 80 non-starter characters)
--  inventory       what each player owns
--  buy_item()      the only way to buy: locks the wallet, reads the price from the catalogue (never from the
--                  game), checks it isn't owned, spends free gems before paid ones, writes the ledger and the
--                  inventory in one transaction; the same idempotency key never charges twice
--  my_store()      the shop as the server sees it (items, prices, owned, wallet)
--  Wearing a character: a starter, or one you own (profiles_check_character)
--  Coins from playing (STORE.md §1.1): daily visit, challenges, critter catches, the arcade, games and
--  levelling up, paid by triggers on what already happens, under a daily cap (your local day).
-- Nothing here removes anything.

-- ---- Earn rates and caps ----
create table if not exists public.economy_config (
  key text primary key,
  value jsonb not null
);
alter table public.economy_config enable row level security;
revoke all on public.economy_config from anon, authenticated;
insert into public.economy_config (key, value) values
  ('coins_daily_cap', '800'),          -- everything earned in a day (your local day)
  ('coins_games_cap', '200'),          -- of which from mini-games
  ('coins_visit', '50'),               -- first visit of the day
  ('coins_visit_streak7', '100'),      -- ... with a streak of 7 days or more
  ('coins_game_win', '20'),
  ('coins_game_play', '5'),
  ('coins_catch', '10'),
  ('coins_catch_rare', '50'),          -- critters worth 15 XP or more (owl, fox, the lost medal)
  ('coins_arcade_best', '20')          -- a new Night Raid best
on conflict (key) do nothing;

create or replace function public.econ(k text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (c.value #>> '{}')::bigint from public.economy_config c where c.key = k), 0);
$$;
revoke all on function public.econ(text) from public, anon, authenticated;

-- ---- The catalogue ----
create table if not exists public.catalog_items (
  id text primary key,
  kind text not null check (kind in ('character', 'pet', 'emote', 'frame', 'decor', 'theme', 'voice')),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'limited', 'event')),
  name text not null,
  price_coins int check (price_coins > 0),
  price_gems int check (price_gems > 0),
  sort int not null default 0,
  active boolean not null default true,
  available_from timestamptz,
  available_to timestamptz,
  check ((price_coins is null) <> (price_gems is null))     -- exactly one price
);
alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from anon, authenticated;
-- Every character that isn't a free starter (src/house/skins.json): Common 2,000 coins, Rare 400 gems,
-- Epic 800 gems. Prices are changed here (or on the admin page), never in the game.
insert into public.catalog_items (id, kind, rarity, name, price_coins, price_gems, sort) values
  ('ninja.camouflagegreen', 'character', 'common', 'Camouflage Green', 2000, null, 1),
  ('ninja.camouflagered', 'character', 'common', 'Camouflage Red', 2000, null, 2),
  ('ninja.cavelion', 'character', 'common', 'Cave Lion', 2000, null, 3),
  ('ninja.cavelion2', 'character', 'common', 'Cave Lion 2', 2000, null, 4),
  ('ninja.cavegirl', 'character', 'common', 'Cave Girl', 2000, null, 5),
  ('ninja.cavegirl2', 'character', 'common', 'Cave Girl 2', 2000, null, 6),
  ('ninja.caveman', 'character', 'common', 'Cave Man', 2000, null, 7),
  ('ninja.caveman2', 'character', 'common', 'Cave Man 2', 2000, null, 8),
  ('ninja.demongreen', 'character', 'rare', 'Demon Green', null, 400, 10),
  ('ninja.demonred', 'character', 'epic', 'Demon Red', null, 800, 11),
  ('ninja.eggboy', 'character', 'common', 'Egg Boy', 2000, null, 12),
  ('ninja.egggirl', 'character', 'common', 'Egg Girl', 2000, null, 13),
  ('ninja.fighterred', 'character', 'common', 'Fighter Red', 2000, null, 15),
  ('ninja.fighterwhite', 'character', 'common', 'Fighter White', 2000, null, 16),
  ('ninja.flam', 'character', 'epic', 'Flame', null, 800, 17),
  ('ninja.gladiatorblue', 'character', 'common', 'Gladiator Blue', 2000, null, 18),
  ('ninja.goldstatue', 'character', 'epic', 'Gold Statue', null, 800, 19),
  ('ninja.greenpig', 'character', 'common', 'Green Pig', 2000, null, 20),
  ('ninja.hunter', 'character', 'common', 'Hunter', 2000, null, 21),
  ('ninja.inspector', 'character', 'common', 'Inspector', 2000, null, 22),
  ('ninja.knight', 'character', 'rare', 'Knight', null, 400, 23),
  ('ninja.knightgold', 'character', 'epic', 'Knight Gold', null, 800, 24),
  ('ninja.lion', 'character', 'common', 'Lion', 2000, null, 25),
  ('ninja.lionboy', 'character', 'common', 'Lion Boy', 2000, null, 26),
  ('ninja.lionorange', 'character', 'common', 'Lion Orange', 2000, null, 27),
  ('ninja.lionyellow', 'character', 'rare', 'Lion Yellow', null, 400, 28),
  ('ninja.mangreen', 'character', 'common', 'Man Green', 2000, null, 29),
  ('ninja.maskfrog', 'character', 'common', 'Mask Frog', 2000, null, 30),
  ('ninja.maskgoldracoon', 'character', 'rare', 'Mask Gold Racoon', null, 400, 31),
  ('ninja.maskracoon', 'character', 'common', 'Mask Racoon', 2000, null, 32),
  ('ninja.master', 'character', 'epic', 'Master', null, 800, 33),
  ('ninja.monk', 'character', 'common', 'Monk', 2000, null, 34),
  ('ninja.monk2', 'character', 'common', 'Monk 2', 2000, null, 35),
  ('ninja.monkey', 'character', 'common', 'Monkey', 2000, null, 36),
  ('ninja.monkeyboxerblue', 'character', 'common', 'Monkey Boxer Blue', 2000, null, 37),
  ('ninja.monkeyboxerred', 'character', 'common', 'Monkey Boxer Red', 2000, null, 38),
  ('ninja.ninjablue', 'character', 'rare', 'Ninja Blue', null, 400, 39),
  ('ninja.ninjablue2', 'character', 'rare', 'Ninja Blue 2', null, 400, 40),
  ('ninja.ninjabomb', 'character', 'rare', 'Ninja Bomb', null, 400, 41),
  ('ninja.ninjadark', 'character', 'rare', 'Ninja Dark', null, 400, 42),
  ('ninja.ninjaeskimo', 'character', 'rare', 'Ninja Arctic', null, 400, 43),
  ('ninja.ninjafire', 'character', 'epic', 'Ninja Fire', null, 800, 44),
  ('ninja.ninjagray', 'character', 'rare', 'Ninja Gray', null, 400, 45),
  ('ninja.ninjagreen', 'character', 'rare', 'Ninja Green', null, 400, 46),
  ('ninja.ninjaleaf', 'character', 'rare', 'Ninja Leaf', null, 400, 47),
  ('ninja.ninjamageblack', 'character', 'rare', 'Ninja Mage Black', null, 400, 48),
  ('ninja.ninjamageorange', 'character', 'rare', 'Ninja Mage Orange', null, 400, 49),
  ('ninja.ninjamasked', 'character', 'rare', 'Ninja Masked', null, 400, 50),
  ('ninja.ninjared', 'character', 'rare', 'Ninja Red', null, 400, 51),
  ('ninja.ninjared2', 'character', 'rare', 'Ninja Red 2', null, 400, 52),
  ('ninja.ninjathunder', 'character', 'epic', 'Ninja Thunder', null, 800, 53),
  ('ninja.ninjawater', 'character', 'rare', 'Ninja Water', null, 400, 54),
  ('ninja.ninjayellow', 'character', 'rare', 'Ninja Yellow', null, 400, 55),
  ('ninja.noble', 'character', 'common', 'Noble', 2000, null, 56),
  ('ninja.oldman2', 'character', 'common', 'Old Man 2', 2000, null, 58),
  ('ninja.oldman3', 'character', 'common', 'Old Man 3', 2000, null, 59),
  ('ninja.oldwoman', 'character', 'common', 'Old Woman', 2000, null, 60),
  ('ninja.pig', 'character', 'common', 'Pig', 2000, null, 61),
  ('ninja.redgladiator', 'character', 'common', 'Red Gladiator', 2000, null, 63),
  ('ninja.redninja3', 'character', 'rare', 'Red Ninja 3', null, 400, 64),
  ('ninja.robotcamouflage', 'character', 'rare', 'Robot Camouflage', null, 400, 65),
  ('ninja.robotgreen', 'character', 'rare', 'Robot Green', null, 400, 66),
  ('ninja.robotgrey', 'character', 'rare', 'Robot Grey', null, 400, 67),
  ('ninja.samurai', 'character', 'rare', 'Samurai', null, 400, 68),
  ('ninja.samuraiblue', 'character', 'rare', 'Samurai Blue', null, 400, 69),
  ('ninja.samuraired', 'character', 'epic', 'Samurai Red', null, 800, 70),
  ('ninja.shaman', 'character', 'common', 'Shaman', 2000, null, 71),
  ('ninja.shamanlion', 'character', 'epic', 'Shaman Lion', null, 800, 72),
  ('ninja.skeleton', 'character', 'rare', 'Skeleton', null, 400, 73),
  ('ninja.skeletondemon', 'character', 'epic', 'Skeleton Demon', null, 800, 74),
  ('ninja.sorcererblack', 'character', 'rare', 'Sorcerer Black', null, 400, 75),
  ('ninja.sorcererorange', 'character', 'rare', 'Sorcerer Orange', null, 400, 76),
  ('ninja.spirit', 'character', 'epic', 'Spirit', null, 800, 77),
  ('ninja.statue', 'character', 'epic', 'Statue', null, 800, 78),
  ('ninja.sultan', 'character', 'rare', 'Sultan', null, 400, 79),
  ('ninja.sultan2', 'character', 'epic', 'Sultan 2', null, 800, 80),
  ('ninja.tengu', 'character', 'rare', 'Tengu', null, 400, 81),
  ('ninja.tengu2', 'character', 'epic', 'Tengu 2', null, 800, 82),
  ('ninja.vampire', 'character', 'epic', 'Vampire', null, 800, 83),
  ('ninja.village6', 'character', 'common', 'Traveller', 2000, null, 84)
on conflict (id) do nothing;

-- ---- What each player owns ----
create table if not exists public.inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.catalog_items(id),
  source text not null check (source in ('coins', 'gems', 'pass', 'event', 'gift', 'vip', 'admin')),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.inventory enable row level security;
revoke all on public.inventory from anon, authenticated;
grant select on public.inventory to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory' and policyname = 'read own inventory') then
    create policy "read own inventory" on public.inventory for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

create or replace function public.owns(who uuid, item text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select item = any (public.starter_characters()) or exists (select 1 from public.inventory i where i.user_id = who and i.item_id = item);
$$;
revoke all on function public.owns(uuid, text) from public, anon, authenticated;

-- Wearing a character: a free starter, or one you own.
create or replace function public.profiles_check_character()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.character_key is not distinct from old.character_key
     and new.character_index is distinct from old.character_index then
    new.character_key := public.character_from_index(new.character_index);
  elsif tg_op = 'INSERT' and new.character_key is null then
    new.character_key := public.character_from_index(new.character_index);
  end if;
  if tg_op = 'UPDATE' and new.character_key is not distinct from old.character_key then
    return new; -- not changing it (it was allowed when it was put on)
  end if;
  if not public.owns(new.id, new.character_key) then
    raise exception 'that character isn''t yours to wear';
  end if;
  return new;
end;
$$;

-- ---- Moving coins or gems (now locks the wallet before the idempotency check, so two calls with the same
-- key at the same moment can't both pay) ----
create or replace function public.grant_currency(who uuid, currency text, amount bigint, reason text, ref_type text default null, ref_id text default null, idempotency_key text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  now_bal bigint;
begin
  if amount = 0 then
    return null;
  end if;
  insert into public.wallets (user_id) values (who) on conflict (user_id) do nothing;
  perform 1 from public.wallets w where w.user_id = who for update;
  if idempotency_key is not null and exists (select 1 from public.ledger l where l.idempotency_key = idempotency_key) then
    return (select l.balance_after from public.ledger l where l.idempotency_key = idempotency_key);
  end if;
  if currency = 'coins' then
    update public.wallets w set coins = w.coins + amount, updated_at = now() where w.user_id = who returning w.coins into now_bal;
  elsif currency = 'gems_free' then
    update public.wallets w set gems_free = w.gems_free + amount, updated_at = now() where w.user_id = who returning w.gems_free into now_bal;
  elsif currency = 'gems_paid' then
    update public.wallets w set gems_paid = w.gems_paid + amount, updated_at = now() where w.user_id = who returning w.gems_paid into now_bal;
  else
    raise exception 'no such currency';
  end if;
  insert into public.ledger (user_id, currency, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
    values (who, currency, amount, now_bal, reason, ref_type, ref_id, idempotency_key);
  return now_bal;
end;
$$;
revoke all on function public.grant_currency(uuid, text, bigint, text, text, text, text) from public, anon, authenticated;

-- ---- Buying ----
create or replace function public.buy_item(item text, idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  it public.catalog_items;
  w public.wallets;
  key text := left(coalesce(idempotency_key, ''), 80);
  from_free bigint;
  from_paid bigint;
begin
  if uid is null or not public.is_member() then
    return jsonb_build_object('ok', false, 'why', 'Members can shop. Ask your host for an invite.');
  end if;
  if length(key) < 8 then
    return jsonb_build_object('ok', false, 'why', 'Something went wrong. Nothing was charged.');
  end if;
  insert into public.wallets (user_id) values (uid) on conflict (user_id) do nothing;
  select * into w from public.wallets x where x.user_id = uid for update;
  -- The same buy again (a double tap, a retry after a timeout): the first answer, no second charge.
  if exists (select 1 from public.ledger l where l.idempotency_key in ('buy:' || uid || ':' || key || ':1', 'buy:' || uid || ':' || key || ':2')) then
    return jsonb_build_object('ok', true, 'repeat', true, 'item', item, 'wallet', public.wallet());
  end if;
  select * into it from public.catalog_items c where c.id = item;
  if it.id is null or not it.active or (it.available_from is not null and it.available_from > now()) or (it.available_to is not null and it.available_to <= now()) then
    return jsonb_build_object('ok', false, 'why', 'That item’s gone from the shop. Nothing was charged.');
  end if;
  if public.owns(uid, item) then
    return jsonb_build_object('ok', false, 'why', 'You already own it.', 'owned', true);
  end if;
  if w.locked or w.gems_paid < 0 then
    return jsonb_build_object('ok', false, 'why', 'Your gem balance is negative after a refund. Top up to keep shopping.');
  end if;
  if it.price_coins is not null then
    if w.coins < it.price_coins then
      return jsonb_build_object('ok', false, 'why', 'Not enough coins: you need ' || to_char(it.price_coins - w.coins, 'FM999,999,999') || ' more.', 'short', it.price_coins - w.coins);
    end if;
    perform public.grant_currency(uid, 'coins', -it.price_coins, 'buy', 'item', item, 'buy:' || uid || ':' || key || ':1');
  else
    if w.gems_free + w.gems_paid < it.price_gems then
      return jsonb_build_object('ok', false, 'why', 'Not enough gems: you need ' || to_char(it.price_gems - w.gems_free - w.gems_paid, 'FM999,999,999') || ' more.', 'short', it.price_gems - w.gems_free - w.gems_paid);
    end if;
    -- Free gems first, then bought ones.
    from_free := least(w.gems_free, it.price_gems);
    from_paid := it.price_gems - from_free;
    if from_free > 0 then
      perform public.grant_currency(uid, 'gems_free', -from_free, 'buy', 'item', item, 'buy:' || uid || ':' || key || ':1');
    end if;
    if from_paid > 0 then
      perform public.grant_currency(uid, 'gems_paid', -from_paid, 'buy', 'item', item, 'buy:' || uid || ':' || key || ':2');
    end if;
  end if;
  insert into public.inventory (user_id, item_id, source) values (uid, item, case when it.price_coins is not null then 'coins' else 'gems' end);
  return jsonb_build_object('ok', true, 'item', item, 'wallet', public.wallet());
end;
$$;
revoke all on function public.buy_item(text, text) from public, anon;
grant execute on function public.buy_item(text, text) to authenticated;

-- ---- Coins from playing ----
-- The start of "today" for this player (their own time zone, as challenges use).
create or replace function public.local_day_start(who uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (date_trunc('day', now() at time zone coalesce(nullif(p.time_zone, ''), 'UTC'))) at time zone coalesce(nullif(p.time_zone, ''), 'UTC')
  from (select 1) one left join public.profiles p on p.id = who;
$$;
revoke all on function public.local_day_start(uuid) from public, anon, authenticated;

create or replace function public.coins_earned_today(who uuid, source text default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.delta), 0)::bigint from public.ledger l
  where l.user_id = who and l.currency = 'coins' and l.delta > 0 and l.reason like 'earn:%'
    and (source is null or l.reason = 'earn:' || source)
    and l.created_at >= public.local_day_start(who);
$$;
revoke all on function public.coins_earned_today(uuid, text) from public, anon, authenticated;

-- Pays `amount` coins for `source` (members only), trimmed to what's left of today's caps. `once`: an id that
-- makes it pay at most once (the day's visit, a challenge, a game). Returns what was paid.
create or replace function public.earn_coins(who uuid, amount bigint, source text, once text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  room bigint;
begin
  if amount <= 0 or not exists (select 1 from auth.users u join public.allowed_emails a on a.email = lower(u.email) where u.id = who) then
    return 0;
  end if;
  insert into public.wallets (user_id) values (who) on conflict (user_id) do nothing;
  perform 1 from public.wallets w where w.user_id = who for update; -- one earning at a time per player (caps)
  room := public.econ('coins_daily_cap') - public.coins_earned_today(who);
  if source = 'game' then
    room := least(room, public.econ('coins_games_cap') - public.coins_earned_today(who, 'game'));
  end if;
  amount := least(amount, room);
  if amount <= 0 then
    return 0;
  end if;
  perform public.grant_currency(who, 'coins', amount, 'earn:' || source, source, left(once, 120), 'earn:' || who || ':' || left(once, 120));
  return amount;
end;
$$;
revoke all on function public.earn_coins(uuid, bigint, text, text) from public, anon, authenticated;

-- XP awards that also pay coins: challenges (daily 40-120, weekly 200-400, by the challenge's XP),
-- critter catches (10, or 50 for the rare ones) and a new Night Raid best.
create or replace function public.coins_for_xp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount <= 0 then
    return new;
  end if;
  if new.reason like 'challenge:d\_%' then
    perform public.earn_coins(new.user_id, least(120, greatest(40, new.amount * 2)), 'challenge', 'challenge:' || new.id);
  elsif new.reason like 'challenge:w\_%' then
    perform public.earn_coins(new.user_id, least(400, greatest(200, new.amount * 2)), 'challenge', 'challenge:' || new.id);
  elsif new.reason like 'catch:%' then
    perform public.earn_coins(new.user_id, case when new.amount >= 15 then public.econ('coins_catch_rare') else public.econ('coins_catch') end, 'catch', 'catch:' || new.id);
  elsif new.reason like 'arcade:%' then
    perform public.earn_coins(new.user_id, public.econ('coins_arcade_best'), 'arcade', 'arcade:' || new.id);
  end if;
  return new;
end;
$$;
create or replace trigger xp_pays_coins after insert on public.xp_ledger
  for each row execute function public.coins_for_xp();

-- The day's first visit (50, or 100 on a streak of 7+) and levelling up (100 x the new level / 10, at least 50),
-- when the player's own play moves them on.
create or replace function public.coins_for_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only from the player's own play (record_events, catching a critter), never from an admin changing a level.
  if auth.uid() is distinct from new.id or current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if new.last_visit_date is not null and new.last_visit_date is distinct from old.last_visit_date then
    perform public.earn_coins(new.id, case when new.streak_days >= 7 then public.econ('coins_visit_streak7') else public.econ('coins_visit') end,
      'visit', 'visit:' || new.last_visit_date);
  end if;
  if new.level > old.level then
    for lv in greatest(old.level + 1, new.level - 19) .. new.level loop
      perform public.earn_coins(new.id, greatest(50, (100 * lv) / 10), 'level', 'level:' || lv);
    end loop;
  end if;
  return new;
end;
$$;
create or replace trigger progress_pays_coins after update of last_visit_date, level on public.profiles
  for each row execute function public.coins_for_progress();

-- Mini-games: 20 for a win, 5 for playing (up to 200 a day from games).
create or replace function public.coins_for_game()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p uuid;
begin
  foreach p in array new.players loop
    perform public.earn_coins(p, case when p = any (new.winner_ids) then public.econ('coins_game_win') else public.econ('coins_game_play') end,
      'game', 'game:' || new.id);
  end loop;
  return new;
end;
$$;
create or replace trigger game_pays_coins after insert on public.game_results
  for each row execute function public.coins_for_game();

-- The shop as the server sees it: every item on sale now, its price, whether you own it, and your wallet.
create or replace function public.my_store()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'wallet', public.wallet(),
    'member', public.is_member(),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'rarity', c.rarity, 'name', c.name,
        'coins', c.price_coins, 'gems', c.price_gems,
        'owned', exists (select 1 from public.inventory i where i.user_id = auth.uid() and i.item_id = c.id)) order by c.sort, c.id)
      from public.catalog_items c
      where c.active and (c.available_from is null or c.available_from <= now()) and (c.available_to is null or c.available_to > now())), '[]'::jsonb),
    'owned', coalesce((select jsonb_agg(i.item_id) from public.inventory i where i.user_id = auth.uid()), '[]'::jsonb),
    'earned_today', public.coins_earned_today(auth.uid()),
    'daily_cap', public.econ('coins_daily_cap')
  );
$$;

revoke all on function public.coins_for_xp() from public, anon, authenticated;
revoke all on function public.coins_for_progress() from public, anon, authenticated;
revoke all on function public.coins_for_game() from public, anon, authenticated;
revoke all on function public.my_store() from public, anon;
grant execute on function public.my_store() to authenticated;

-- Faces on the boards: the weekly and catches boards return the old character number, which can't show a
-- bought character, so the game asks for the skins of the people on a board.
create or replace function public.skins_of(ids uuid[])
returns table (user_id uuid, character_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.character_key from public.profiles p
  where p.id = any (ids[1:100]) and ((select public.is_member()) or (select public.is_guest()));
$$;
revoke all on function public.skins_of(uuid[]) from public, anon;
grant execute on function public.skins_of(uuid[]) to authenticated;
