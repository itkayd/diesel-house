import type { Zone } from '../config';

export const overlay = () => document.getElementById('overlay') as HTMLDivElement;

let zoneLabel: HTMLDivElement | null = null;

// Small badge showing where the player is standing.
export function showZone(zone: Zone | null) {
  if (!zoneLabel) {
    zoneLabel = document.createElement('div');
    zoneLabel.style.cssText =
      'position:absolute;top:max(12px,env(safe-area-inset-top));left:12px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.55);font-size:14px';
    overlay().appendChild(zoneLabel);
  }
  zoneLabel.textContent = !zone ? '' : zone === 'hallway' ? 'Hallway' : `Room ${Number(zone.slice(-2))}`;
}

let statusLabel: HTMLDivElement | null = null;

// Connection badge under the zone badge: "Connecting…", "3 in the house", "Offline".
export function showStatus(text: string, ok: boolean) {
  if (!statusLabel) {
    statusLabel = document.createElement('div');
    statusLabel.id = 'status';
    statusLabel.style.cssText =
      'position:absolute;top:calc(max(12px,env(safe-area-inset-top)) + 32px);left:12px;padding:3px 10px;border-radius:999px;background:rgba(0,0,0,.55);font-size:12px';
    overlay().appendChild(statusLabel);
  }
  statusLabel.textContent = `${ok ? '🟢' : '⚪'} ${text}`;
}
