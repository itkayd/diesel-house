import { expectedPos, linkStart, parseMediaLink, type Media, type MediaState } from '../house/media';
import { icon } from './icons';
import { FakePlayer, SpotifyPlayer, YouTubePlayer, type MediaPlayer } from './mediaPlayers';
import { mixer } from './mixer';
import { el, openModal } from './modal';
import { hudBottomRight, overlay } from './overlay';
import { play } from './sounds';
import { toast } from './toasts';

// Watch & listen together (Lounge TV, Disco). A TV button while you're in one of those rooms opens
// "Put something on": paste a YouTube or Spotify link and it plays for everyone in the room. The player
// sits under the top bar; its buttons (play/pause, back/forward 10 s, stop) act for everyone, and every
// screen keeps in step with the room (supabase/migrations/20261106_watch_together.sql). Sound: videos
// start muted so phones let them play; "Tap for sound" turns yours on. Hide tucks it away for you only.
export type WatchDeps = {
  room: () => string | null; // the screen room you're in, or null
  state: () => MediaState | null;
  set: (m: (Media & { pos: number; paused: boolean }) | null) => Promise<string | null>; // error or null
  nameOf: (id: string | null) => string;
  fake?: boolean; // tests: a stand-in player
};

const DRIFT = 2.5; // s: further off than this, jump back in step
const SYNC_EVERY = 2000;

export class WatchTogether {
  private btn = el('button', 'dh-iconbtn');
  private screen = el('div', 'dh-screen');
  private frame = el('div', 'frame');
  private cap = el('div', 'cap');
  private sound = el('button', 'dh-chip sound');
  private playBtn = el('button', 'dh-iconbtn');
  private player: MediaPlayer | null = null;
  private showing: string | null = null; // kind:id loaded
  private hidden = false; // tucked away (you only)
  private chip = el('button', 'dh-chip dh-screen-chip');
  private busy = false;

  constructor(private deps: WatchDeps) {
    this.btn.type = 'button';
    this.btn.id = 'watch-button';
    this.btn.setAttribute('aria-label', 'Watch together');
    this.btn.append(icon('tv'));
    this.btn.hidden = true;
    this.btn.addEventListener('click', () => this.openSheet());
    hudBottomRight().prepend(this.btn);

    this.screen.id = 'screen';
    this.screen.hidden = true;
    this.screen.setAttribute('role', 'region');
    this.screen.setAttribute('aria-label', 'Watch together');
    this.frame.id = 'screen-frame';
    this.sound.type = 'button';
    this.sound.id = 'screen-sound';
    this.sound.append(icon('volume-x', { width: 16 }), 'Tap for sound');
    this.sound.addEventListener('click', () => {
      this.player?.setMuted(false);
      this.renderBar();
    });
    const bar = el('div', 'bar');
    const button = (id: string, label: string, ic: Parameters<typeof icon>[0], f: () => void) => {
      const b = id === 'screen-play' ? this.playBtn : el('button', 'dh-iconbtn');
      b.type = 'button';
      b.id = id;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.replaceChildren(icon(ic));
      b.addEventListener('click', f);
      return b;
    };
    bar.append(
      button('screen-back', 'Back 10 s (for everyone)', 'rewind', () => void this.nudge(-10)),
      button('screen-play', 'Play / pause (for everyone)', 'pause', () => void this.togglePause()),
      button('screen-fwd', 'Forward 10 s (for everyone)', 'fast-forward', () => void this.nudge(10)),
      button('screen-stop', 'Stop (for everyone)', 'square', () => void this.change(null)),
      el('span', 'grow'),
      button('screen-big', 'Bigger', 'maximize-2', () => this.screen.classList.toggle('big')),
      button('screen-hide', 'Hide (just for you)', 'chevron-down', () => this.setHidden(true)),
    );
    this.screen.append(this.frame, this.sound, this.cap, bar);
    overlay().append(this.screen);

    this.chip.type = 'button';
    this.chip.id = 'screen-chip';
    this.chip.hidden = true;
    this.chip.addEventListener('click', () => this.setHidden(false));
    overlay().append(this.chip);

    mixer.onChange(() => this.player?.setVolume(mixer.levels.music));
    setInterval(() => this.sync(), SYNC_EVERY);
  }

  get playerForTests() {
    return this.player;
  }

  private setHidden(on: boolean) {
    this.hidden = on;
    this.sync();
  }

  // Bring this screen in line with the room: what's on, playing or paused, and where.
  sync() {
    const room = this.deps.room();
    const st = room ? this.deps.state() : null;
    this.btn.hidden = !room;
    if (!room || !st) {
      this.drop();
      this.screen.hidden = true;
      this.chip.hidden = true;
      document.getElementById('overlay')?.classList.remove('has-screen');
      return;
    }
    const key = `${st.kind}:${st.id}`;
    const want = expectedPos(st);
    if (this.showing !== key) {
      if (this.player && this.player.kind !== (this.deps.fake ? 'fake' : st.kind)) this.drop();
      this.player ??= this.deps.fake ? new FakePlayer(this.frame) : st.kind === 'youtube' ? new YouTubePlayer(this.frame, (w) => this.problem(w)) : new SpotifyPlayer(this.frame, (w) => this.problem(w));
      this.player.setVolume(mixer.levels.music);
      this.player.load(st, want, st.paused);
      this.showing = key;
      this.screen.classList.toggle('spotify', st.kind === 'spotify');
    } else if (this.player) {
      if (st.paused) this.player.pause();
      else this.player.play();
      const t = this.player.time();
      if (t !== null && Math.abs(t - want) > DRIFT) this.player.seek(want);
    }
    this.screen.hidden = this.hidden;
    this.chip.hidden = !this.hidden;
    document.getElementById('overlay')?.classList.toggle('has-screen', !this.hidden);
    const title = this.player?.title() || (st.kind === 'spotify' ? 'Spotify' : 'YouTube');
    this.chip.replaceChildren(icon('tv', { width: 16 }), document.createTextNode(`${st.paused ? 'Paused' : 'Playing'}: ${title} · Show`));
    this.cap.textContent = `${title}${st.by ? ` · put on by ${this.deps.nameOf(st.by)}` : ''}${st.kind === 'spotify' ? ' · log in to Spotify for full songs' : ''}`;
    this.renderBar();
  }

  private renderBar() {
    const st = this.deps.state();
    this.playBtn.replaceChildren(icon(st?.paused ? 'play' : 'pause'));
    this.sound.hidden = !this.player?.canMute || !this.player.muted;
  }

  private drop() {
    this.player?.destroy();
    this.player = null;
    this.showing = null;
    this.screen.classList.remove('big');
  }

  private problem(why: string) {
    toast({ icon: 'tv', id: 'screen-problem', who: 'Watch together', what: why, small: true, ttl: 4000 });
  }

  private async change(m: (Media & { pos: number; paused: boolean }) | null) {
    if (this.busy) return;
    this.busy = true;
    const err = await this.deps.set(m);
    this.busy = false;
    if (err) {
      play('error', 0.4);
      if (!/too soon/.test(err)) this.problem(err);
      return;
    }
    play('click', 0.25);
    this.sync();
  }

  private togglePause() {
    const st = this.deps.state();
    if (st) void this.change({ kind: st.kind, id: st.id, pos: expectedPos(st), paused: !st.paused });
  }

  private nudge(by: number) {
    const st = this.deps.state();
    if (st) void this.change({ kind: st.kind, id: st.id, pos: Math.max(0, expectedPos(st) + by), paused: st.paused });
  }

  // "Put something on": paste a link.
  private openSheet() {
    const { panel, close } = openModal('watch', { dismissable: true, label: 'watch-title' });
    const head = el('div', 'v2-head');
    const h = el('h2', '', 'Watch together');
    h.id = 'watch-title';
    const x = el('button', 'dh-iconbtn');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.append(icon('x'));
    x.addEventListener('click', close);
    head.append(icon('tv'), h, x);
    const st = this.deps.state();
    const now = el('p', 'v2-note', st ? `On now: ${this.player?.title() || (st.kind === 'spotify' ? 'something from Spotify' : 'a YouTube video')}${st.by ? `, put on by ${this.deps.nameOf(st.by)}` : ''}.` : 'Nothing on. Paste a link and everyone in this room watches or listens with you.');
    now.id = 'watch-now';
    const form = el('form');
    form.style.cssText = 'display:grid;gap:10px';
    form.noValidate = true; // our own message for a link we can't play
    const input = el('input', 'dh-input');
    input.id = 'watch-link';
    input.type = 'url';
    input.inputMode = 'url';
    input.placeholder = 'Paste a YouTube or Spotify link';
    input.setAttribute('aria-label', 'YouTube or Spotify link');
    input.autocomplete = 'off';
    const err = el('p', 'dh-error');
    err.id = 'watch-error';
    err.hidden = true;
    const go = el('button', 'dh-btn');
    go.type = 'submit';
    go.id = 'watch-go';
    go.append(icon('play'), 'Play for everyone here');
    form.append(input, err, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const m = parseMediaLink(input.value);
      if (!m) {
        err.textContent = 'That isn’t a YouTube or Spotify link. Try one like youtube.com/watch?v=… or open.spotify.com/track/…';
        err.hidden = false;
        play('error', 0.4);
        return;
      }
      close();
      this.hidden = false;
      void this.change({ ...m, pos: m.kind === 'youtube' ? linkStart(input.value) : 0, paused: false });
    });
    const tips = el('p', 'v2-note', 'YouTube videos and music, Spotify songs, albums and playlists. Anyone in the room can pause, skip or stop it. Spotify plays full songs for people logged in to Spotify, and 30 s previews for everyone else.');
    panel.append(head, now, form, tips);
    if (st) {
      const stop = el('button', 'dh-btn dh-btn--quiet');
      stop.type = 'button';
      stop.id = 'watch-stop';
      stop.append(icon('square', { width: 16 }), 'Stop it for everyone');
      stop.addEventListener('click', () => {
        close();
        void this.change(null);
      });
      panel.append(stop);
    }
    if (window.matchMedia('(pointer: fine)').matches) input.focus();
  }
}
