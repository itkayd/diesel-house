import { TRACKS, trackName } from '../house/jukebox';
import { icon } from './icons';
import { el, openModal } from './modal';
import { hudBottomRight } from './overlay';
import { play } from './sounds';
import { toast } from './toasts';

// The Disco's jukebox card: a button by the chat button while you're in the Disco, opening the list of
// tracks. Picking one plays it for everyone in the room; Stop stops it for everyone.
export type JukeboxDeps = {
  now: () => { track: string | null; by: string | null }; // what's playing, and who put it on
  choose: (track: string | null) => Promise<string | null>; // an error message, or null
};

export class JukeboxButton {
  private btn = el('button', 'dh-iconbtn');

  constructor(private deps: JukeboxDeps) {
    this.btn.type = 'button';
    this.btn.id = 'jukebox-button';
    this.btn.setAttribute('aria-label', 'Jukebox');
    this.btn.append(icon('music'));
    this.btn.hidden = true;
    this.btn.addEventListener('click', () => this.open());
    hudBottomRight().prepend(this.btn);
  }

  setVisible(on: boolean) {
    this.btn.hidden = !on;
    if (!on) document.getElementById('jukebox')?.remove();
  }

  // Something changed (a track started or stopped): a little "playing" look, and refresh an open card.
  refresh() {
    const { track } = this.deps.now();
    this.btn.classList.toggle('on', !!track);
    if (document.getElementById('jukebox')) this.render();
  }

  private open() {
    const { panel } = openModal('jukebox', { dismissable: true, label: 'jukebox-title' });
    panel.dataset.jukebox = '1';
    this.render();
  }

  private render() {
    const panel = document.querySelector<HTMLElement>('#jukebox .dh-panel');
    if (!panel) return;
    const { track, by } = this.deps.now();
    const head = el('div', 'v2-head');
    const h = el('h2', '', 'Jukebox');
    h.id = 'jukebox-title';
    const x = el('button', 'dh-iconbtn');
    x.type = 'button';
    x.id = 'jukebox-close';
    x.setAttribute('aria-label', 'Close');
    x.append(icon('x'));
    x.addEventListener('click', () => document.getElementById('jukebox')?.remove());
    head.append(icon('music'), h, x);
    const now = el('p', 'v2-note', track ? `Now playing: ${trackName(track)}${by ? ` · put on by ${by}` : ''}. Everyone in the Disco hears it.` : 'Nothing playing. Pick a track: everyone in the Disco hears it.');
    now.id = 'jukebox-now';
    const list = el('div', 'v2-list');
    for (const t of TRACKS) {
      const row = el('button', 'v2-item dh-track' + (t.id === track ? ' on' : ''));
      row.type = 'button';
      row.dataset.track = t.id;
      row.setAttribute('aria-pressed', String(t.id === track));
      row.append(icon(t.id === track ? 'volume-2' : 'play', { width: 18 }), el('span', 't', t.name), el('span', 's', `${Math.round(t.len)} s loop`));
      row.addEventListener('click', () => void this.pick(t.id === track ? null : t.id));
      list.append(row);
    }
    const stop = el('button', 'dh-btn dh-btn--quiet');
    stop.type = 'button';
    stop.id = 'jukebox-stop';
    stop.disabled = !track;
    stop.append(icon('square', { width: 16 }), 'Stop the music');
    stop.addEventListener('click', () => void this.pick(null));
    const credit = el('p', 'v2-note', 'Chiptunes by ansimuz (CC0). Turn music down in Settings → Sound.');
    panel.replaceChildren(head, now, list, stop, credit);
  }

  private async pick(track: string | null) {
    const err = await this.deps.choose(track);
    if (err) {
      play('error', 0.4);
      toast({ icon: 'music', id: 'jukebox', who: 'Couldn’t change the music', what: /too soon/.test(err) ? 'Someone just changed it. Try again in a moment.' : err, small: true, ttl: 2500 });
      return;
    }
    play('click', 0.3);
  }
}
