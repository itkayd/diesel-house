import { overlay } from './overlay';

// A pixel card over a dimmed scrim (design/game/mvp.html `modal()`): picker, settings, mic card, credits.
// On phones the theme turns it into a bottom sheet. Tapping the scrim closes it if `dismissable`.
export function openModal(id: string, opts: { dismissable?: boolean; onDismiss?: () => void; label?: string } = {}) {
  document.getElementById(id)?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'dh-scrim';
  scrim.id = id;
  const panel = document.createElement('div');
  panel.className = 'dh-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  if (opts.label) panel.setAttribute('aria-labelledby', opts.label);
  scrim.append(panel);
  if (opts.dismissable)
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim) {
        scrim.remove();
        opts.onDismiss?.();
      }
    });
  overlay().append(scrim);
  return { scrim, panel, close: () => scrim.remove() };
}

export const modalOpen = () => !!document.querySelector('#overlay .dh-scrim');

// Little builders used by several screens.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
