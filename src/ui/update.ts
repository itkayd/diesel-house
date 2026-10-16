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
