import { SKINS, STARTERS, type Skin } from '../characters';
import { devTest } from './mode';
import { supabase } from './supabase';

// The shop (STORE.md phase S2, supabase/migrations/20261118_store.sql). The server decides everything:
// prices, what you own and your balance come from my_store() / buy_item(); this only remembers the last
// answer so the screen can show it. The one sum done here is the confirm card's "After" preview, and the
// server's answer replaces it. Test mode (?test) keeps a pretend wallet on this device, with the same rules.

export type Wallet = { coins: number; gems: number; locked: boolean };
export type ShopItem = { id: string; rarity: string; name: string; coins: number | null; gems: number | null };
export type BuyResult = { ok: true; item: string; wallet: Wallet } | { ok: false; why: string; short?: number };

let wallet: Wallet | null = null;
const items = new Map<string, ShopItem>();
const owned = new Set<string>();
let member = false;
let earnedToday = 0;
let dailyCap = 800;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export const currentWallet = () => wallet;
export const shopItem = (id: string) => items.get(id) ?? null;
export const ownsItem = (id: string) => STARTERS.includes(id) || owned.has(id);
export const ownedSkins = (): Skin[] => [...STARTERS, ...SKINS.filter((s) => owned.has(s.key)).map((s) => s.key)];
export const canShop = () => member;
export const coinsToday = () => ({ earned: earnedToday, cap: dailyCap });
export function onStore(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

// Whole numbers with thousands separators, one helper for every amount on screen (UI-REVIEW §4).
export const fmtAmount = (n: number) => Math.trunc(n).toLocaleString('en-GB');

// ---- Test mode: the same rules, on this device ----
const FAKE_PRICE = { common: { coins: 2000, gems: null }, rare: { coins: null, gems: 400 }, epic: { coins: null, gems: 800 } } as const;
let fake: { wallet: Wallet; owned: Set<string> } | null = null;
const fakeShop = () => {
  fake ??= { wallet: { coins: 2500, gems: 500, locked: false }, owned: new Set() };
  return fake;
};

function take(data: { wallet: Wallet; member: boolean; items: ShopItem[]; owned: string[]; earned_today?: number; daily_cap?: number }) {
  wallet = data.wallet;
  member = data.member;
  items.clear();
  for (const i of data.items) items.set(i.id, i);
  owned.clear();
  for (const id of data.owned) owned.add(id);
  earnedToday = data.earned_today ?? earnedToday;
  dailyCap = data.daily_cap ?? dailyCap;
  changed();
}

// The shop as the server sees it (the catalogue, what you own, your wallet).
export async function loadStore(guest = false): Promise<boolean> {
  if (!supabase || devTest) {
    const f = fakeShop();
    take({
      wallet: { ...f.wallet },
      member: !guest,
      items: SKINS.filter((s) => s.rarity !== 'starter').map((s) => ({ id: s.key, rarity: s.rarity, name: s.name, ...FAKE_PRICE[s.rarity as keyof typeof FAKE_PRICE] })),
      owned: [...f.owned],
    });
    return true;
  }
  const { data, error } = await supabase.rpc('my_store');
  if (error || !data) return false;
  take(data as Parameters<typeof take>[0]);
  return true;
}

// Just the balance (after coins were earned: a challenge, a game, a catch).
let walletTimer: ReturnType<typeof setTimeout> | null = null;
export function refreshWallet(delay = 800) {
  if (!supabase || devTest) return;
  if (walletTimer) clearTimeout(walletTimer);
  walletTimer = setTimeout(async () => {
    walletTimer = null;
    const { data } = await supabase!.rpc('wallet');
    if (data) {
      wallet = data as Wallet;
      changed();
    }
  }, delay);
}

// One buy at a time; a key per buy, so a double tap or a retry after a timeout never charges twice.
let busy: Promise<BuyResult> | null = null;
const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 80);

export function buy(id: string): Promise<BuyResult> {
  if (busy) return busy;
  const key = newKey();
  busy = attempt(id, key).finally(() => (busy = null));
  return busy;
}

async function attempt(id: string, key: string): Promise<BuyResult> {
  if (!supabase || devTest) {
    const f = fakeShop();
    const it = items.get(id);
    if (!member) return { ok: false, why: 'Members can shop. Ask your host for an invite.' };
    if (!it) return { ok: false, why: 'That item’s gone from the shop. Nothing was charged.' };
    if (f.owned.has(id)) return { ok: false, why: 'You already own it.' };
    if (it.coins !== null && f.wallet.coins < it.coins) return { ok: false, why: `Not enough coins: you need ${fmtAmount(it.coins - f.wallet.coins)} more.`, short: it.coins - f.wallet.coins };
    if (it.gems !== null && f.wallet.gems < it.gems) return { ok: false, why: `Not enough gems: you need ${fmtAmount(it.gems - f.wallet.gems)} more.`, short: it.gems - f.wallet.gems };
    if (it.coins !== null) f.wallet.coins -= it.coins;
    else if (it.gems !== null) f.wallet.gems -= it.gems;
    f.owned.add(id);
    await loadStore();
    return { ok: true, item: id, wallet: { ...f.wallet } };
  }
  // A slow answer: ask again with the same key (charged at most once), then check what we own.
  for (let tries = 0; tries < 2; tries++) {
    const answer = await Promise.race([
      supabase.rpc('buy_item', { item: id, idempotency_key: key }).then(({ data, error }) => (error ? null : (data as BuyResult & { wallet?: Wallet; owned?: boolean }))),
      new Promise<'slow'>((r) => setTimeout(() => r('slow'), 10_000)),
    ]);
    if (answer === 'slow') continue;
    if (!answer) break;
    await loadStore(); // what the server says now: wallet, owned
    return answer.ok ? { ok: true, item: id, wallet: currentWallet()! } : { ok: false, why: answer.why, short: answer.short };
  }
  await loadStore();
  if (owned.has(id)) return { ok: true, item: id, wallet: currentWallet()! };
  return { ok: false, why: 'Couldn’t reach the shop. Nothing was charged. Try again in a moment.' };
}

if (devTest) (window as unknown as { __store?: unknown }).__store = { fakeShop, loadStore };

// Faces on the boards (weekly, catches): their rows carry the old character number, which can't show a
// bought character, so ask for the skins of the people on a board (skins_of, members and guests only).
export async function withSkins<T extends { user_id: string; character_key?: string }>(rows: T[]): Promise<T[]> {
  if (!supabase || devTest || !rows.length) return rows;
  const { data } = await supabase.rpc('skins_of', { ids: rows.map((r) => r.user_id) });
  const keys = new Map(((data ?? []) as { user_id: string; character_key: string }[]).map((r) => [r.user_id, r.character_key]));
  return rows.map((r) => ({ ...r, character_key: keys.get(r.user_id) ?? r.character_key }));
}
