import type { Section } from '../main';
import { act, ago, api, badge, btn, card, confirmBox, empty, field, h, icon, input, sectionHead, skeleton, toast, when } from '../kit';

type Code = { id: number; label: string | null; created_at: string; used_at: string | null; usedByName: string | null; revoked_at: string | null };
type Guest = { id: string; name: string | null; host: string | null; admitted_at: string; expires_at: string; banned: boolean };

// Invite codes for new members (single use), and the guests visiting now.
export const invites: Section = {
  id: 'invites',
  label: 'Invites & guests',
  icon: 'ticket',
  async render(main, go) {
    const label = input({ placeholder: 'Who it’s for (optional), e.g. Sam', maxlength: 40, id: 'invite-label', 'aria-label': 'Who the code is for' });
    const shown = h('div', { id: 'invite-new' });
    const make = h('button', { type: 'button', class: 'adm-btn gold', id: 'invite-make' }, icon('plus'), 'Make an invite code');
    make.addEventListener('click', () =>
      void act(make, async () => {
        const r = await api<{ code: string }>('make-code', { label: label.value.trim() || null });
        label.value = '';
        shown.replaceChildren(newCode(r.code));
        await drawCodes();
      }),
    );
    const bulk = h('textarea', { class: 'adm-area', id: 'invite-bulk', placeholder: 'ABCD-1234 Sam\nWXYZ-5678 Alex', 'aria-label': 'Codes you already have' }) as HTMLTextAreaElement;
    const addBulk = btn('Add these codes', () => {
      const codes = bulk.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [code, ...rest] = l.split(/\s+/);
        return { code, label: rest.join(' ') || undefined };
      });
      if (!codes.length) return toast('Type at least one code.', true);
      void act(null, async () => {
        const r = await api<{ results: { code: string; ok: boolean; problem?: string }[] }>('add-codes', { codes });
        const bad = r.results.filter((x) => !x.ok);
        bulk.value = bad.map((x) => x.code).join('\n');
        toast(bad.length ? `${r.results.length - bad.length} added; ${bad.length} not: ${bad[0].problem}` : `${r.results.length} added.`, !!bad.length);
        await drawCodes();
      });
    }, { icon: 'plus', small: true });

    const codesBox = h('div', { class: 'adm-list', id: 'invite-codes' }, skeleton(3));
    const guestsBox = h('div', { class: 'adm-list', id: 'guest-list' }, skeleton(2));
    main.append(
      sectionHead('Invites & guests', 'Each invite code works once and makes a member account. Guests come in with a member’s guest code and leave when their visit ends.'),
      h(
        'div',
        { class: 'adm-grid' },
        card('New invite', 'ticket', h('p', { class: 'adm-hint' }, 'Send the code to your friend with the link. It’s shown once: copy it now.'), label, make, shown),
        card('Guests visiting', 'door', guestsBox),
      ),
      card('Invite codes', 'scroll', codesBox),
      h('details', { class: 'adm-log' }, h('summary', {}, icon('plus'), h('span', {}, h('b', {}, 'Add codes you already have'), h('small', {}, 'One per line: the code, then who it’s for.'))), h('div', { class: 'adm-log-body' }, bulk, addBulk)),
    );

    async function drawCodes() {
      const r = await api<{ codes: Code[]; members: number }>('codes');
      const rows = r.codes.map((c) => {
        const state = c.revoked_at ? badge('Cancelled') : c.used_at ? badge(`Used by ${c.usedByName ?? 'someone'}`, 'ok') : badge('Waiting', 'warn');
        const cancel = !c.used_at && !c.revoked_at
          ? btn('Cancel', async () => {
              if (!(await confirmBox('Cancel this code?', 'Nobody will be able to use it.', { ok: 'Cancel the code', danger: true }))) return;
              await act(null, () => api('revoke-code', { id: c.id }), 'Code cancelled.');
              await drawCodes();
            }, { kind: 'ghost', small: true })
          : null;
        return h('div', { class: 'adm-row' }, icon('ticket'), h('span', { class: 'adm-row-main' }, h('b', {}, c.label ?? 'Invite'), h('small', {}, `Made ${when(c.created_at)}${c.used_at ? ` · used ${ago(c.used_at)}` : ''}`)), h('span', { class: 'adm-row-side' }, state, cancel));
      });
      codesBox.replaceChildren(...(rows.length ? rows : [empty('ticket', 'No invite codes yet. Make one above.')]));
    }

    async function drawGuests() {
      const list = await api<Guest[]>('guests');
      const now = Date.now();
      const rows = list.map((g) => {
        const live = new Date(g.expires_at).getTime() > now;
        return h(
          'div',
          { class: 'adm-row' },
          h('span', { class: 'adm-avatar' }, (g.name ?? '?')[0]?.toUpperCase() ?? '?'),
          h('span', { class: 'adm-row-main' }, h('b', {}, g.name ?? 'Guest'), h('small', {}, `${g.host ? `invited by ${g.host} · ` : ''}${live ? `until ${when(g.expires_at)}` : `left ${ago(g.expires_at)}`}`)),
          h(
            'span',
            { class: 'adm-row-side' },
            g.banned ? badge('Banned', 'bad') : live ? badge('Here', 'ok') : badge('Left'),
            live ? btn('End visit', () => void act(null, async () => { await api('guest-end', { guest: g.id }); await drawGuests(); }, 'Visit ended.'), { kind: 'ghost', small: true }) : null,
            !g.banned
              ? btn('Ban', async () => {
                  if (!(await confirmBox(`Ban ${g.name ?? 'this guest'}?`, 'Their visit ends now and they can’t come back with this guest account.', { ok: 'Ban', danger: true }))) return;
                  await act(null, async () => { await api('ban', { member: g.id, reason: 'guest' }); await drawGuests(); }, 'Guest banned.');
                }, { kind: 'ghost', small: true })
              : null,
          ),
        );
      });
      guestsBox.replaceChildren(...(rows.length ? rows : [empty('door', 'No guests in the last day. Members make guest codes from their profile.', btn('See players', () => go('players'), { small: true }))]));
    }

    await Promise.all([drawCodes(), drawGuests()]);
  },
};

function newCode(code: string) {
  const copy = btn('Copy', async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Copied.');
    } catch {
      toast('Couldn’t copy: select it and copy by hand.', true);
    }
  }, { icon: 'copy', small: true, id: 'invite-copy' });
  return h('div', { class: 'adm-field' }, field('The new code (shown once)', h('div', { class: 'adm-code', id: 'invite-code' }, code)), copy);
}
