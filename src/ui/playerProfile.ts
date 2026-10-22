import type { Skin } from '../characters';
import { supabase } from '../net/supabase';
import { devTest } from '../net/mode';
import { addFriend, answerFriend, friendOf, isBlocked, reportPlayer, setBlock, type ReportReason } from '../net/social';
import { ACHIEVEMENTS, RANK_MEDALS } from '../challenges/pool';
import { legendStars, rankOf } from '../challenges/levels';
import { icon, type IconName } from './icons';
import { el, openModal } from './modal';
import { portrait } from './portrait';
import { levelChip, medalEl } from './progressUi';
import { blockDialog, reportDialog } from './safety';
import { toast } from './toasts';

// Anyone's profile (opened from the tap-a-friend menu, a name in the chat, or Who's where): face, name,
// level and rank, medals, a few stats, and Add friend · Message · Report · Block.
// (Your own profile, with your guest code and settings, is src/ui/profile.ts.)

export type PublicProfile = {
  id: string; name: string | null; character: Skin | null; pet: string | null; member: boolean; me: boolean;
  level: number | null; xp: number | null; streak: number | null; best_streak: number | null; joined: string; last_on: string | null; host: string | null;
  medals: string[]; arcade_best: number | null; games_won: number; critters: number; friends: number;
  friend: 'none' | 'friends' | 'incoming' | 'outgoing'; blocked: boolean; banned: boolean;
};
export type ProfileDeps = {
  where: (id: string) => string | null; // "In the Lounge" when they're in the house now
  message: (id: string, name: string, character: Skin | null) => void;
  reportContext: (id: string) => Record<string, unknown>;
  blocked: (id: string) => void; // after Block (voice and chat update)
  amGuest: boolean;
  // Test mode: what the database would say.
  fake?: (id: string) => PublicProfile | null;
};

const MEDALS = new Map([...ACHIEVEMENTS, ...RANK_MEDALS].map((m) => [m.id, m]));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

async function load(id: string, deps: ProfileDeps): Promise<PublicProfile | null> {
  if (!supabase || devTest) return deps.fake?.(id) ?? null;
  const { data, error } = await supabase.rpc('player_profile', { who: id });
  if (error) throw new Error('Couldn’t load their profile. Try again in a moment.');
  return data as PublicProfile | null;
}

export function openPlayerProfile(id: string, name: string, deps: ProfileDeps) {
  const ui = openModal('player-profile', { dismissable: true, label: 'player-profile-title' });
  const head = el('div', 'v2-head');
  const t = el('h2', '', name);
  t.id = 'player-profile-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'player-profile-close';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', ui.close);
  head.append(icon('user-round'), t, x);
  const body = el('div', 'v2-pp');
  body.append(el('div', 'dh-skeleton'), el('div', 'dh-skeleton'));
  ui.panel.append(head, body);

  const draw = (p: PublicProfile) => {
    const who = p.name ?? name;
    t.textContent = who;
    // Face, name, level and rank.
    const top = el('div', 'v2-me');
    const face = el('div', 'big');
    face.style.cursor = 'default';
    if (p.character) face.append(portrait(p.character, 72));
    const info = el('div');
    info.style.cssText = 'display:grid;gap:6px;min-width:0';
    const nm = el('div', 'nm');
    nm.append(el('b', 'v2-pp-name', who));
    const chips = el('div');
    chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    if (p.member && p.level) {
      chips.append(levelChip(p.level));
      const r = rankOf(p.level);
      const rank = el('span', 'v2-chip', `${r.title}${legendStars(p.level) ? ` ${legendStars(p.level)}` : ''}`);
      rank.style.background = r.colour;
      chips.append(rank);
    } else chips.append(el('span', 'v2-chip', p.host ? `Guest of ${p.host}` : 'Guest'));
    if (p.friend === 'friends') chips.append(el('span', 'v2-chip gold', '★ Friend'));
    if (p.blocked || isBlocked(p.id)) chips.append(el('span', 'v2-chip', 'Blocked'));
    const where = deps.where(p.id);
    info.append(nm, chips, el('span', 'v2-note', where ?? (p.last_on ? `Last on ${day(p.last_on)}` : 'Not in the house')));
    top.append(face, info);

    // Stats.
    const stats = el('div', 'v2-stats');
    const stat = (v: number | string, label: string) => {
      const d = el('div', 'v2-stat');
      d.append(el('b', '', typeof v === 'number' ? v.toLocaleString() : v), el('span', '', label));
      return d;
    };
    if (p.member) stats.append(stat(p.streak ?? 0, 'day streak'), stat(p.games_won, 'games won'), stat(p.arcade_best ?? 0, 'Night Raid best'), stat(p.critters, 'critters caught'), stat(p.friends, 'friends'), stat(p.medals.length, 'medals'));

    // Facts.
    const facts = el('div', 'v2-facts');
    const fact = (ic: IconName, text: string) => {
      const d = el('div');
      d.append(icon(ic), el('span', '', text));
      return d;
    };
    facts.append(fact('calendar', p.member ? `In the house since ${day(p.joined)}` : `Visiting since ${day(p.joined)}`));
    if (p.member && p.best_streak) facts.append(fact('flame', `Best streak: ${p.best_streak} days`));

    // Medals.
    const medals = el('div', 'v2-badges');
    medals.id = 'player-profile-medals';
    for (const mid of p.medals) {
      const m = MEDALS.get(mid);
      if (!m) continue;
      const b = el('div', 'v2-badge');
      b.title = `${m.name}: ${m.how}`;
      b.append(medalEl(m, 40), el('span', '', m.name));
      medals.append(b);
    }

    // Actions.
    const acts = el('div', 'v2-pp-acts');
    const btn = (label: string, ic: IconName, id: string, go: (b: HTMLButtonElement) => void, quiet = true) => {
      const b = el('button', quiet ? 'dh-btn dh-btn--quiet' : 'dh-btn');
      b.type = 'button';
      b.id = id;
      b.append(icon(ic, { width: 18 }), document.createTextNode(label));
      b.addEventListener('click', () => go(b));
      return b;
    };
    if (!p.me) {
      const status = friendOf(p.id)?.status ?? p.friend;
      const canFriend = p.member && !deps.amGuest && !p.blocked;
      if (canFriend) {
        const label = status === 'friends' ? 'Friends' : status === 'incoming' ? 'Accept friend' : status === 'outgoing' ? 'Request sent' : 'Add friend';
        const f = btn(label, status === 'friends' ? 'check' : 'user-round', 'pp-friend', (b) => {
          b.disabled = true;
          const go = status === 'incoming' ? answerFriend(p.id, true).then(() => 'friends' as const) : addFriend(p.id, who, p.character);
          go.then(
            (s) => {
              toast({ icon: 'users', who, what: s === 'friends' ? 'You’re friends now.' : 'Friend request sent.', small: true, ttl: 3000 });
              void refresh();
            },
            (e) => {
              b.disabled = false;
              toast({ icon: 'info', who: 'Not sent', what: (e as Error).message, small: true, ttl: 3500 });
            },
          );
        });
        f.disabled = status === 'friends' || status === 'outgoing';
        acts.append(f);
      }
      if (!p.blocked && !isBlocked(p.id)) acts.append(btn('Message', 'message-square', 'pp-message', () => (ui.close(), deps.message(p.id, who, p.character)), false));
      acts.append(
        btn('Report', 'info', 'pp-report', () =>
          reportDialog(who, (reason: ReportReason, details: string) => reportPlayer(p.id, reason, details, deps.reportContext(p.id))),
        ),
      );
      if (!p.blocked && !isBlocked(p.id))
        acts.append(
          btn('Block', 'volume-x', 'pp-block', () =>
            blockDialog(who, () => setBlock(p.id, who, true), () => {
              deps.blocked(p.id);
              ui.close();
            }),
          ),
        );
      else
        acts.append(
          btn('Unblock', 'rotate-ccw', 'pp-unblock', (b) => {
            b.disabled = true;
            void setBlock(p.id, who, false).then(() => {
              deps.blocked(p.id);
              void refresh();
            });
          }),
        );
    }

    body.replaceChildren(top);
    if (p.member) body.append(stats);
    body.append(facts);
    if (medals.children.length) body.append(el('div', 'dh-label', 'Medals'), medals);
    body.append(acts);
  };

  const refresh = async () => {
    try {
      const p = await load(id, deps);
      if (!ui.panel.isConnected) return;
      if (!p) return void body.replaceChildren(el('p', 'v2-note', 'This person isn’t in the house any more.'));
      draw(p);
    } catch (e) {
      body.replaceChildren(el('p', 'v2-note', (e as Error).message));
    }
  };
  void refresh();
  return ui;
}
