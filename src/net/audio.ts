// One shared AudioContext, unlocked from a real tap or key press. iPhones (and some other browsers) keep
// audio suspended unless sound is started inside a user gesture; joining a room happens on a timer, so
// we unlock on the first gesture anywhere and, failing that, ask for a tap (see ui/soundBanner.ts).

let ctx: AudioContext | null = null;
const onUnlock = new Set<() => void>();

export function audioContext() {
  ctx ??= new AudioContext();
  return ctx;
}

export const audioLocked = () => !ctx || ctx.state !== 'running';

// Must run inside a user gesture (pointer/key/touch handler).
export function unlockAudio() {
  const c = audioContext();
  void c.resume().then(() => onUnlock.forEach((f) => f()));
  // iOS also wants a sound actually started within the gesture: a one-sample silent buffer.
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22050);
  src.connect(c.destination);
  src.start(0);
  // Retry any voice <audio> elements the browser refused to start earlier.
  document.querySelectorAll<HTMLAudioElement>('audio[data-peer]').forEach((a) => void a.play().catch(() => {}));
}

export function whenAudioUnlocked(f: () => void) {
  onUnlock.add(f);
}

// Listens for the first gestures until audio is running.
export function installAudioUnlock() {
  const events = ['pointerdown', 'touchend', 'keydown'] as const;
  const handler = () => {
    unlockAudio();
    if (ctx?.state === 'running') events.forEach((e) => window.removeEventListener(e, handler, true));
  };
  events.forEach((e) => window.addEventListener(e, handler, true));
}
