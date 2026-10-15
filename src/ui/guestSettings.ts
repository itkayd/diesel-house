import { myGuestCode, newGuestCode, setGuestCode, type GuestCode } from '../net/guestCodes';
import { el } from './modal';
import { addSettingsSection, switchRow } from './settings';

// "Your guests" in settings (members only): your invite code to share, a switch for it, "open house" for
// letting anyone in without a code, and a way to replace the code.
export function addGuestSettings(memberId: () => string | null) {
  addSettingsSection(
    40,
    async (box) => {
      const id = memberId();
      if (!id) return;
      let gc: GuestCode | null = await myGuestCode(id);
      const title = el('div', 'dh-title', 'Your guests');
      title.style.fontSize = '17px';
      const status = el('small', 'dh-lede');
      status.id = 'guest-code-status';
      status.setAttribute('aria-live', 'polite');
      const body = el('div');
      body.style.cssText = 'display:grid;gap:10px';
      box.style.gap = '10px';
      box.append(title, el('small', 'dh-lede', 'Nobody gets in without one of you. Share your code and friends can visit as guests for 12 hours.'), body, status);

      const render = () => {
        if (!gc) {
          const make = el('button', 'dh-btn', 'Make my invite code');
          make.type = 'button';
          make.id = 'make-guest-code';
          make.addEventListener('click', async () => {
            const r = await newGuestCode(id, false);
            if (typeof r === 'string') status.textContent = r;
            else {
              gc = r;
              render();
            }
          });
          body.replaceChildren(make);
          return;
        }
        const code = el('div', '', gc.code);
        code.id = 'guest-code';
        code.style.cssText = `font-family:var(--font-display);font-size:30px;letter-spacing:.08em;text-align:center;color:${gc.enabled ? 'var(--lamp)' : 'var(--faint)'}`;
        const copies = el('div');
        copies.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
        const copy = el('button', 'dh-btn dh-btn--quiet', 'Copy code');
        copy.type = 'button';
        const share = el('button', 'dh-btn dh-btn--quiet', 'Copy an invite message');
        share.type = 'button';
        const message = `Come and hang out at Diesel House: open ${location.origin}, tap "Come in as a guest" and use my code ${gc.code}.`;
        copy.addEventListener('click', async () => {
          await navigator.clipboard?.writeText(gc!.code).catch(() => {});
          copy.textContent = 'Copied';
        });
        share.addEventListener('click', async () => {
          await navigator.clipboard?.writeText(message).catch(() => {});
          share.textContent = 'Copied';
        });
        copies.append(copy, share);
        const save = async (change: Partial<GuestCode>) => {
          const err = await setGuestCode(id, change);
          if (err) status.textContent = `Couldn't save: ${err}`;
          else {
            gc = { ...gc!, ...change };
            status.textContent = 'Saved';
            render();
          }
        };
        const replace = el('button', 'dh-btn dh-btn--quiet', 'New code (the old one stops working)');
        replace.type = 'button';
        replace.id = 'replace-guest-code';
        replace.addEventListener('click', async () => {
          const r = await newGuestCode(id, true);
          if (typeof r === 'string') status.textContent = r;
          else {
            gc = r;
            status.textContent = 'New code made';
            render();
          }
        });
        body.replaceChildren(
          code,
          copies,
          switchRow('guest-code-on', 'Guests can use my code', 'Switch off to stop new guests using it', gc.enabled, (on) => void save({ enabled: on })),
          switchRow('open-house', 'Open house', 'Anyone can come in as a guest, no code needed', gc.open_house, (on) => void save({ open_house: on })),
          replace,
        );
      };
      render();
    },
    true,
  );
}
