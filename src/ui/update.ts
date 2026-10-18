// After an update, a page that has been open a while (or a phone resuming the home-screen app) can be
// running the old game, whose code files no longer exist. Reload once to get the new version.
const KEY = 'diesel-house.reloaded-at';

// Reloads unless we already did in the last minute (so a real outage can't cause a reload loop).
export function reloadForUpdate(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked: reload anyway
  }
  location.reload();
  return true;
}

// Vite reports a code file that failed to load.
export function installUpdateReload() {
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    reloadForUpdate();
  });
}

// A new version went live while this page was open (or the phone resumed an old copy): the site's
// index.html now points at a different main-<hash>.js. Checked when the page comes back to the front and
// every 2 minutes. Out of a call it reloads straight away; in a call it offers "Reload" instead of
// cutting anyone off. While the page is in use (the timer), it only offers. (Dev builds have no hashed
// files, so this does nothing there.)
const CHECK_EVERY = 2 * 60_000;
let offered = false;

async function latestMain(): Promise<string | null> {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    return html.match(/\/assets\/main-[\w-]+\.js/)?.[0] ?? null;
  } catch {
    return null; // offline: try again later
  }
}

// `current`: for automated checks only (the dev server has no hashed files).
export function watchForNewVersion(inCall: () => boolean, offer: (reload: () => void) => void, current?: string) {
  const mine = current ?? document.querySelector<HTMLScriptElement>('script[src*="/assets/main-"]')?.getAttribute('src')?.match(/\/assets\/main-[\w-]+\.js/)?.[0];
  if (!mine) return; // dev server
  // `returning`: the page just came back to the front (or loaded), so a reload won't interrupt anything.
  const check = async (returning: boolean) => {
    const latest = await latestMain();
    if (!latest || latest === mine) return;
    if (returning && !inCall()) return void reloadForUpdate();
    if (offered) return;
    offered = true;
    offer(() => location.reload());
  };
  document.addEventListener('visibilitychange', () => !document.hidden && void check(true));
  setInterval(() => !document.hidden && void check(false), CHECK_EVERY);
  void check(true);
}
