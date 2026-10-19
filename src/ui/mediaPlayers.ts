import type { Media } from '../house/media';

// The players behind Watch together: the official YouTube and Spotify embeds (their iframe APIs), and a
// stand-in for automated tests (?test&fakemedia), all behind one small interface. Each browser streams
// from YouTube / Spotify itself; nothing is re-broadcast.
export interface MediaPlayer {
  readonly kind: string;
  load(m: Media, pos: number, paused: boolean): void;
  play(): void;
  pause(): void;
  seek(s: number): void;
  time(): number | null; // seconds, or null while it isn't ready
  title(): string;
  setMuted(on: boolean): void;
  readonly muted: boolean;
  canMute: boolean;
  setVolume(v: number): void; // 0..1
  destroy(): void;
}

function loadScript(src: string) {
  return new Promise<void>((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => fail(new Error(`couldn't load ${src}`));
    document.head.append(s);
  });
}

// ---- YouTube (youtube-nocookie, no YouTube controls: ours act for everyone) ----
type YTPlayer = {
  loadVideoById(o: { videoId: string; startSeconds: number }): void;
  cueVideoById(o: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allow: boolean): void;
  getCurrentTime(): number;
  getVideoData(): { title?: string };
  mute(): void;
  unMute(): void;
  setVolume(v: number): void;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, o: object) => YTPlayer };
let ytReady: Promise<YTNamespace> | null = null;
function youtubeApi() {
  ytReady ??= new Promise((ok, fail) => {
    const w = window as unknown as { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) return ok(w.YT);
    w.onYouTubeIframeAPIReady = () => ok(w.YT!);
    loadScript('https://www.youtube.com/iframe_api').catch(fail);
  });
  return ytReady;
}

export class YouTubePlayer implements MediaPlayer {
  readonly kind = 'youtube';
  private p: YTPlayer | null = null;
  private ready = false;
  private pending: (() => void) | null = null;
  muted = true; // starts muted so phones let it play; "Tap for sound" unmutes
  canMute = true;
  private vol = 1;

  constructor(private host: HTMLElement, private onError: (why: string) => void) {}

  load(m: Media, pos: number, paused: boolean) {
    const go = () => {
      const o = { videoId: m.id, startSeconds: Math.floor(pos) };
      if (paused) this.p!.cueVideoById(o);
      else this.p!.loadVideoById(o);
    };
    if (this.ready) return go();
    if (this.p) return void (this.pending = go);
    const el = document.createElement('div');
    this.host.replaceChildren(el);
    youtubeApi().then(
      (YT) => {
        this.p = new YT.Player(el, {
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          videoId: m.id,
          playerVars: { autoplay: paused ? 0 : 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(pos), mute: 1, origin: location.origin },
          events: {
            onReady: () => {
              this.ready = true;
              this.p!.mute();
              this.p!.setVolume(Math.round(this.vol * 100));
              if (paused) this.p!.pauseVideo();
              else this.p!.playVideo();
              this.pending?.();
              this.pending = null;
            },
            onError: (e: { data: number }) => this.onError(e.data === 101 || e.data === 150 ? 'This video can’t be played outside YouTube.' : 'That video didn’t load.'),
          },
        });
      },
      () => this.onError('Couldn’t reach YouTube.'),
    );
  }
  play() {
    if (this.ready) this.p!.playVideo();
  }
  pause() {
    if (this.ready) this.p!.pauseVideo();
  }
  seek(s: number) {
    if (this.ready) this.p!.seekTo(s, true);
  }
  time() {
    return this.ready ? this.p!.getCurrentTime() : null;
  }
  title() {
    return (this.ready && this.p!.getVideoData()?.title) || '';
  }
  setMuted(on: boolean) {
    this.muted = on;
    if (!this.ready) return;
    if (on) this.p!.mute();
    else this.p!.unMute();
  }
  setVolume(v: number) {
    this.vol = v;
    if (this.ready) this.p!.setVolume(Math.round(v * 100));
  }
  destroy() {
    this.p?.destroy();
    this.host.replaceChildren();
  }
}

// ---- Spotify (iframe API: full tracks for people logged in to Spotify, 30 s previews otherwise) ----
type SpotifyController = {
  loadUri(uri: string): void;
  play(): void;
  pause(): void;
  resume(): void;
  seek(s: number): void;
  addListener(e: string, f: (e: { data: { position: number; isPaused: boolean; duration: number } }) => void): void;
  destroy(): void;
};
type SpotifyApi = { createController(el: HTMLElement, o: object, cb: (c: SpotifyController) => void): void };
let spReady: Promise<SpotifyApi> | null = null;
function spotifyApi() {
  spReady ??= new Promise((ok, fail) => {
    (window as unknown as { onSpotifyIframeApiReady: (api: SpotifyApi) => void }).onSpotifyIframeApiReady = ok;
    loadScript('https://open.spotify.com/embed/iframe-api/v1').catch(fail);
  });
  return spReady;
}

export class SpotifyPlayer implements MediaPlayer {
  readonly kind = 'spotify';
  private c: SpotifyController | null = null;
  private pos: number | null = null;
  muted = false;
  canMute = false; // Spotify's own player has its own volume
  private want: { pos: number; paused: boolean } | null = null;

  constructor(private host: HTMLElement, private onError: (why: string) => void) {}

  load(m: Media, pos: number, paused: boolean) {
    const uri = `spotify:${m.id}`;
    this.want = { pos, paused };
    if (this.c) {
      this.c.loadUri(uri);
      return this.start();
    }
    const el = document.createElement('div');
    this.host.replaceChildren(el);
    spotifyApi().then(
      (api) =>
        api.createController(el, { uri, width: '100%', height: '100%' }, (c) => {
          this.c = c;
          c.addListener('playback_update', (e) => (this.pos = e.data.position / 1000));
          c.addListener('ready', () => this.start());
        }),
      () => this.onError('Couldn’t reach Spotify.'),
    );
  }
  private start() {
    const w = this.want;
    if (!this.c || !w) return;
    if (!w.paused) this.c.play(); // browsers may still ask for a tap first: Spotify shows its own play button
    if (w.pos > 1) setTimeout(() => this.c?.seek(w.pos), 600);
  }
  play() {
    this.c?.resume();
  }
  pause() {
    this.c?.pause();
  }
  seek(s: number) {
    this.c?.seek(s);
  }
  time() {
    return this.pos;
  }
  title() {
    return '';
  }
  setMuted() {}
  setVolume() {}
  destroy() {
    this.c?.destroy();
    this.host.replaceChildren();
  }
}

// ---- A stand-in for automated tests: a clock with play / pause / seek ----
export class FakePlayer implements MediaPlayer {
  readonly kind = 'fake';
  private base = 0;
  private since: number | null = null;
  muted = true;
  canMute = true;
  loaded: Media | null = null;
  constructor(private host: HTMLElement) {}
  load(m: Media, pos: number, paused: boolean) {
    this.loaded = m;
    this.host.textContent = `▶ ${m.kind}:${m.id}`;
    this.base = pos;
    this.since = paused ? null : performance.now();
  }
  play() {
    if (this.since === null) this.since = performance.now();
  }
  pause() {
    this.base = this.time();
    this.since = null;
  }
  seek(s: number) {
    this.base = s;
    if (this.since !== null) this.since = performance.now();
  }
  time() {
    return this.base + (this.since === null ? 0 : (performance.now() - this.since) / 1000);
  }
  title() {
    return this.loaded ? `Test video ${this.loaded.id}` : '';
  }
  setMuted(on: boolean) {
    this.muted = on;
  }
  setVolume() {}
  get paused() {
    return this.since === null;
  }
  destroy() {
    this.host.replaceChildren();
  }
}
