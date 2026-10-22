import type { ReportReason } from '../net/social';
import { icon } from './icons';
import { el, openModal } from './modal';
import { toast } from './toasts';

// Block and Report as their own cards (used from a profile; the tap-a-friend menu has the same steps
// inside its little card, src/ui/friendMenu.ts).

export const REPORT_REASONS: [ReportReason, string][] = [
  ['harassment', 'Bullying or harassment'],
  ['hate', 'Hate or threats'],
  ['spam', 'Spamming'],
  ['cheating', 'Cheating'],
  ['other', 'Something else'],
];

function card(id: string, title: string) {
  const ui = openModal(id, { dismissable: true, label: `${id}-title` });
  const head = el('div', 'v2-head');
  const t = el('h2', '', title);
  t.id = `${id}-title`;
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', ui.close);
  head.append(t, x);
  ui.panel.append(head);
  return ui;
}

export function blockDialog(name: string, go: () => Promise<void>, done?: () => void) {
  const ui = card('block-dialog', `Block ${name}?`);
  const yes = el('button', 'dh-btn');
  yes.type = 'button';
  yes.id = 'block-dialog-yes';
  yes.append(icon('volume-x', { width: 18 }), document.createTextNode(`Block ${name}`));
  const no = el('button', 'dh-btn dh-btn--quiet', 'Cancel');
  no.type = 'button';
  no.addEventListener('click', ui.close);
  yes.addEventListener('click', () => {
    yes.disabled = true;
    go().then(
      () => {
        ui.close();
        toast({ icon: 'volume-x', who: `${name} is blocked`, what: 'You won’t hear them, see their chat or get their messages. Settings → More to undo.', ttl: 4500 });
        done?.();
      },
      (e) => {
        yes.disabled = false;
        toast({ icon: 'info', who: 'Not blocked', what: (e as Error).message, small: true, ttl: 3500 });
      },
    );
  });
  ui.panel.append(el('p', 'v2-note', 'You won’t hear them, see their chat, or get their messages, emotes, duels and game invites. They aren’t told. You can undo it any time.'), yes, no);
}

export function reportDialog(name: string, send: (reason: ReportReason, details: string) => Promise<void>) {
  const ui = card('report-dialog', `Report ${name}`);
  let reason: ReportReason | null = null;
  const chips = el('div', 'dh-chips');
  const go = el('button', 'dh-btn');
  go.type = 'button';
  go.id = 'report-dialog-send';
  go.disabled = true;
  go.append(icon('send', { width: 18 }), document.createTextNode('Send to Diesel'));
  for (const [id, label] of REPORT_REASONS) {
    const c = el('button', 'dh-chip', label);
    c.type = 'button';
    c.dataset.reason = id;
    c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', () => {
      reason = id;
      for (const x of chips.children) x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.reason === id));
      go.disabled = false;
    });
    chips.append(c);
  }
  const text = el('textarea', 'dh-input dh-report-text');
  text.id = 'report-dialog-details';
  text.rows = 3;
  text.maxLength = 1000;
  text.placeholder = 'What happened? (optional)';
  go.addEventListener('click', () => {
    if (!reason) return;
    go.disabled = true;
    send(reason, text.value.trim()).then(
      () => {
        ui.close();
        toast({ icon: 'check', who: 'Report sent', what: `Thanks. Diesel will look at it. You can also block ${name}.`, ttl: 4000 });
      },
      (e) => {
        go.disabled = false;
        toast({ icon: 'info', who: 'Not sent', what: (e as Error).message, small: true, ttl: 3500 });
      },
    );
  });
  ui.panel.append(el('p', 'v2-note', 'What’s wrong? It goes to Diesel with where you are and their last messages. They aren’t told.'), chips, text, go);
}
