import { GUEST_SKINS, skinDef, STARTERS, type Skin } from '../characters';
import { toast } from '../ui/toasts';
import type { PlayerInfo } from '../net/presence';
import { currentUser, loadProfile, saveProfile } from '../net/profile';
import { guestHosts } from '../net/guestCodes';
import { saveCharacter, savedCharacter, saveName, savedName } from '../prefs';
import { pickCharacter } from '../ui/picker';
import { openProfile } from '../ui/profile';
import { gamesWon } from '../net/games';
import type { HouseScene } from '../scenes/HouseScene';

// Who you are: your profile or the picker, names and characters, the profile card, and guests' hosts.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

// Who are you? Your profile if you have one; otherwise the picker, once, saved to your profile.
export async function identify(this: HouseScene, saved: Skin | null, name: string | null) {
  const user = currentUser();
  if (user && !user.guest) {
    const profile = await loadProfile(user.id);
    if (profile && !profile.picked) {
      // Just joined: their name is known, the character isn't chosen yet.
      saveName(profile.display_name);
      return void this.choose(true);
    }
    if (profile) {
      this.applyIdentity(profile.character_key, profile.display_name);
      return void this.start();
    }
    // New here: offer the picker, prefilled with anything this device remembers.
    return void this.choose();
  }
  if (user?.guest) void this.hostOf(user.id); // for the settings line
  if (saved === null || name === null) void this.choose();
  else void this.start();
}

// Whose friend a guest is. Asks the database again (at most every 3 s) when someone new turns up.
export async function hostOf(this: HouseScene, id: string): Promise<string | null> {
  if (!this.hosts.has(id) && Date.now() - this.hostsAsked > 3000) {
    this.hostsAsked = Date.now();
    this.hosts = await guestHosts();
  }
  return this.hosts.get(id) ?? null;
}

export function showHost(this: HouseScene, p: PlayerInfo) {
  if (p.guest) void this.hostOf(p.id).then((h) => this.remotes.get(p.id)?.avatar.setHost(h));
}

export function applyIdentity(this: HouseScene, character: Skin, name: string) {
  this.character = character;
  this.name = name;
  saveCharacter(character);
  saveName(name);
  this.me.setCharacter(character);
  this.me.setName(name);
  this.progressHud?.render();
}

// `mustPick`: first visit, no way to close without choosing.
export async function choose(this: HouseScene, mustPick = false) {
  this.canMove = false;
  this.body.setVelocity(0, 0);
  const guest = !!currentUser()?.guest;
  const remembered = savedCharacter();
  const wearable = guest ? GUEST_SKINS : STARTERS;
  const current = remembered !== null && wearable.includes(remembered) ? remembered : null;
  const choice = await pickCharacter(this.textures, current, savedName(), mustPick ? false : undefined, wearable, guest);
  if (!choice) {
    this.canMove = true; // closed without changes
    void this.start(); // still join the house (does nothing if already in)
    return;
  }
  const { character, name } = choice;
  if (choice.tryOn) {
    this.canMove = true;
    return void this.tryOn(choice.tryOn);
  }
  this.applyIdentity(character, name);
  const user = currentUser();
  if (user && !user.guest) await saveProfile(user.id, name, character);
  if (this.presence) this.presence.update({ character, name });
  void this.start();
}

// Your profile (HUD button, or tap your own name tag).
export function openMyProfile(this: HouseScene) {
  const user = currentUser();
  if (!user) return void this.choose();
  if (!user.guest && !document.getElementById('profile')) void this.tracker.flush(); // fresh XP (other tabs, phones)
  openProfile({
    name: this.name,
    character: this.character,
    host: this.hosts.get(user.id) ?? null,
    changeCharacter: () => void this.choose(),
    rename: async (name) => {
      this.applyIdentity(this.character, name);
      if (!user.guest) {
        await saveProfile(user.id, name, this.character);
      }
      this.presence?.update({ name });
    },
    progress: this.progress,
    gamesWon: () => gamesWon(user.id),
  });
  if (this.progress) document.getElementById('profile')?.setAttribute('data-xp', String(this.progress.xp));
}

// Try a shop character on for 60 s (STORE.md §3.1): only this screen shows it; everyone else still sees
// your own character, and it goes back by itself.
let tryOnTimer = 0;
export function tryOn(this: HouseScene, skin: Skin) {
  clearTimeout(tryOnTimer);
  this.me.setCharacter(skin);
  toast({ icon: 'timer', id: 'try-on', who: `Trying on ${skinDef(skin)?.name ?? 'a character'}`, what: 'For 60 s. Only you see it.', small: true, ttl: 4000 });
  tryOnTimer = window.setTimeout(() => {
    this.me.setCharacter(this.character);
    toast({ icon: 'timer', id: 'try-on', who: 'Back to your own character', what: 'The shop is coming soon.', small: true, ttl: 2500 });
  }, 60_000);
}
