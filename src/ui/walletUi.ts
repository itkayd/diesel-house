import { currentWallet, fmtAmount, onStore } from '../net/store';
import { icon } from './icons';
import { el } from './modal';

// Your coins and gems in the top bar, beside your level (UI-REVIEW §3 rule 1): whatever the server last said
// (src/net/store.ts). Tapping them (or the little gold bag) opens the Shop. Members only.
export function addWalletChips(openShop: () => void) {
  const box = el('button', 'v2-wallet');
  box.type = 'button';
  box.id = 'wallet-chips';
  box.hidden = true;
  const coins = el('span', 'dh-coin coin');
  const gems = el('span', 'dh-coin gem');
  const bag = el('span', 'bag');
  bag.append(icon('shopping-bag', { width: 16, height: 16 }));
  box.append(coins, gems, bag);
  box.addEventListener('click', openShop);
  const pulse = (c: HTMLElement) => {
    c.classList.remove('pulse');
    void c.offsetWidth;
    c.classList.add('pulse');
  };
  let last: { coins: number; gems: number } | null = null;
  const render = () => {
    const w = currentWallet();
    box.hidden = !w;
    if (!w) return;
    coins.replaceChildren(icon('coins', { width: 16 }), el('b', '', fmtAmount(w.coins)));
    gems.replaceChildren(icon('gem', { width: 16 }), el('b', '', fmtAmount(w.gems)));
    box.setAttribute('aria-label', `Shop: you have ${fmtAmount(w.coins)} coins and ${fmtAmount(w.gems)} gems`);
    box.title = 'Shop';
    if (last && w.coins !== last.coins) pulse(coins);
    if (last && w.gems !== last.gems) pulse(gems);
    last = { coins: w.coins, gems: w.gems };
  };
  document.querySelector('#overlay .v2-progress')?.append(box);
  onStore(render);
  render();
}
