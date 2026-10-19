import { audioContext } from '../net/audio';
import { mixer } from '../ui/mixer';

// The Disco's jukebox (REDESIGN.md §2, R4). One track loops for everyone in the room: the database keeps
// which track and when it started (rooms.music, music_at; set_room_music()), and each browser works out
// where in the loop it is. Only heard inside the Disco; it fades in and out at the door. Uses the Music
// slider in Settings → Sound.
// Tracks: CC0 chiptunes by ansimuz (A Meta Data Game), converted to MP3 for iPhones. `len` is the loop's
// exact length from the original files (MP3 adds a little silence at the start).
export const TRACKS = [
  { id: 'sun_tribe', name: 'Sun Tribe', len: 31.501 },
  { id: 'determination', name: 'Determination', len: 21.656 },
  { id: 'ghost_town', name: 'Ghost Town', len: 36.0 },
  { id: 'sun_tribe_inside', name: 'Sun Tribe (inside)', len: 15.751 },
] as const;
export type TrackId = (typeof TRACKS)[number]['id'];
export const trackName = (id: string | null | undefined) => TRACKS.find((t) => t.id === id)?.name ?? '';

const FADE = 0.6; // s
const LEVEL = 0.55; // under voices: it's a bed, not a concert

export class Jukebox {
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private playing: { key: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted: { track: TrackId; at: number } | null = null;

  constructor() {
    // iPhone: sound only starts after a tap; pick up where we should be once it does.
    audioContext().addEventListener('statechange', () => this.apply());
  }

  // What should be heard: a track started at `at` (ms), or nothing.
  set(track: string | null | undefined, at: string | number | null | undefined) {
    const t = TRACKS.find((x) => x.id === track);
    const when = typeof at === 'string' ? Date.parse(at) : (at ?? NaN);
    this.wanted = t && Number.isFinite(when) ? { track: t.id, at: when } : null;
    this.apply();
  }

  get now() {
    return this.playing?.key.split('@')[0] ?? null;
  }

  private buffer(id: string) {
    let b = this.buffers.get(id);
    if (!b) {
      b = fetch(`assets/music/${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((d) => audioContext().decodeAudioData(d))
        .catch(() => null);
      this.buffers.set(id, b);
    }
    return b;
  }

  private apply() {
    const w = this.wanted;
    const key = w ? `${w.track}@${w.at}` : null;
    if (key === (this.playing?.key ?? null)) return;
    this.stop();
    if (!w || !key) return;
    const ctx = audioContext();
    if (ctx.state !== 'running') return; // waits for the first tap (statechange)
    void this.buffer(w.track).then((buf) => {
      if (!buf || this.wanted !== w || this.playing) return;
      const t = TRACKS.find((x) => x.id === w.track)!;
      const pad = Math.max(0, buf.duration - t.len); // the MP3's lead-in silence
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = pad;
      src.loopEnd = pad + t.len;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + FADE);
      src.connect(gain).connect(mixer.bus('music'));
      const into = (((Date.now() - w.at) / 1000) % t.len + t.len) % t.len;
      src.start(0, pad + into);
      this.playing = { key, src, gain };
    });
  }

  stop() {
    const p = this.playing;
    this.playing = null;
    if (!p) return;
    const ctx = audioContext();
    p.gain.gain.cancelScheduledValues(ctx.currentTime);
    p.gain.gain.setValueAtTime(p.gain.gain.value, ctx.currentTime);
    p.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
    p.src.stop(ctx.currentTime + FADE + 0.05);
  }
}
