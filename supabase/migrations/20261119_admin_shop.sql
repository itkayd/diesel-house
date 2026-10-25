-- The admin page's Shop section (STORE.md S2): every item with its price, whether it's on sale and how many
-- own it; change a price (coins or gems, never both) or take it off sale; the coin earn rates and caps
-- (economy_config); give a player a character. Same locks as every admin_* function: only the server calls
-- them, each checks the session token first, and every change goes in the audit log.

create or replace function public.admin_shop(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'rarity', c.rarity, 'name', c.name,
        'coins', c.price_coins, 'gems', c.price_gems, 'active', c.active,
        'owners', (select count(*) from public.inventory i where i.item_id = c.id)) order by c.sort, c.id)
      from public.catalog_items c), '[]'),
    'config', coalesce((select jsonb_object_agg(e.key, e.value) from public.economy_config e), '{}'),
    'sold_week', (select count(*) from public.inventory i where i.acquired_at > now() - interval '7 days' and i.source in ('coins', 'gems')),
    'coins_spent_week', (select coalesce(-sum(l.delta), 0) from public.ledger l where l.currency = 'coins' and l.reason = 'buy' and l.created_at > now() - interval '7 days'),
    'coins_earned_week', (select coalesce(sum(l.delta), 0) from public.ledger l where l.currency = 'coins' and l.reason like 'earn:%' and l.created_at > now() - interval '7 days')
  );
end;
$$;

create or replace function public.admin_shop_item(token text, item text, price_coins integer, price_gems integer, active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if (price_coins is null) = (price_gems is null) then
    return jsonb_build_object('ok', false, 'why', 'Give it one price: coins or gems.');
  end if;
  if coalesce(price_coins, price_gems) not between 1 and 100000000 then
    return jsonb_build_object('ok', false, 'why', 'A price is a whole number from 1 up.');
  end if;
  update public.catalog_items c set price_coins = admin_shop_item.price_coins, price_gems = admin_shop_item.price_gems, active = admin_shop_item.active
  where c.id = item;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'No such item.');
  end if;
  perform public.admin_audit_log(acct, 'edit shop item', item, jsonb_build_object('coins', price_coins, 'gems', price_gems, 'active', active));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_econ_set(token text, setting text, amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if amount not between 0 and 100000000 then
    return jsonb_build_object('ok', false, 'why', 'A whole number from 0 up.');
  end if;
  update public.economy_config e set value = to_jsonb(amount) where e.key = setting;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'No such setting.');
  end if;
  perform public.admin_audit_log(acct, 'edit coin rate', setting, jsonb_build_object('value', amount));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_give_item(token text, member uuid, item text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if not exists (select 1 from public.catalog_items c where c.id = item) then
    return jsonb_build_object('ok', false, 'why', 'No such item.');
  end if;
  if not exists (select 1 from public.profiles p where p.id = member) then
    return jsonb_build_object('ok', false, 'why', 'No such player.');
  end if;
  insert into public.inventory (user_id, item_id, source) values (member, item, 'admin') on conflict do nothing;
  perform public.admin_audit_log(acct, 'give item', member::text, jsonb_build_object('item', item));
  return jsonb_build_object('ok', true);
end;
$$;

-- Only the server may call these.
revoke all on function public.admin_shop(text) from public, anon, authenticated;
revoke all on function public.admin_shop_item(text, text, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.admin_econ_set(text, text, bigint) from public, anon, authenticated;
revoke all on function public.admin_give_item(text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_shop(text) to service_role;
grant execute on function public.admin_shop_item(text, text, integer, integer, boolean) to service_role;
grant execute on function public.admin_econ_set(text, text, bigint) to service_role;
grant execute on function public.admin_give_item(text, uuid, text) to service_role;
