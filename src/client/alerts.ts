// "It's your turn" alerts: vibration (Android; iPhone websites can't vibrate) and a short chime
// (Android and iPhone). Both are switchable in the menu.
//
// Browsers only allow sound/vibration after the person has tapped the page at least once
// (Chrome: "sticky user activation"; iPhone: the audio has to be unlocked by a tap). Players tap
// constantly, so in practice this only matters right after opening or reloading the app.

import type { TableView } from '../game/protocol';

export type AlertKind = 'turn' | 'check' | 'pick';

/**
 * Which alert (if any) the change from `prev` to `next` deserves for this player.
 * Pure, so it's unit-tested. No alert for the first view (opening or reloading the app).
 */
export function alertFor(prev: TableView | null, next: TableView): AlertKind | null {
  const me = next.you;
  const r = next.round;
  if (!prev || !me || !r || next.phase !== 'playing' || !r.hand) return null;
  const p = prev.phase === 'playing' ? prev.round : null;
  if (r.awaitingPick === me && p?.awaitingPick !== me) return 'pick';
  if (r.show && r.show.by !== me && !r.show.acks.includes(me) && p?.show?.by !== r.show.by) return 'check';
  // Only when the turn passes to me (a new round counts), not when my own show or pick resolves.
  const newRound = !p || p.roundNo !== r.roundNo;
  if (r.turn === me && (newRound || p.turn !== me)) return 'turn';
  return null;
}

// ---------- Vibration ----------

export const canVibrate = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const PATTERN: Record<AlertKind, number[]> = {
  turn: [120, 80, 120],
  check: [80],
  pick: [80, 60, 80, 60, 80],
};

function vibrate(kind: AlertKind): void {
  try {
    navigator.vibrate?.(PATTERN[kind]);
  } catch {
    // Ignored: some browsers throw instead of returning false.
  }
}

// ---------- Chime (Web Audio, no sound files) ----------

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call once at start-up: the first tap anywhere unlocks sound (needed on iPhone). */
export function unlockAudioOnFirstTap(): void {
  const unlock = () => {
    const c = audio();
    if (c && c.state !== 'running') void c.resume().catch(() => {});
    // A silent tick: iPhone only really unlocks after something plays inside the tap.
    if (c) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(c.destination);
      const o = c.createOscillator();
      o.connect(g);
      o.start();
      o.stop(c.currentTime + 0.01);
    }
    if (c?.state === 'running') {
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
    }
  };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);
}

const NOTES: Record<AlertKind, number[]> = {
  turn: [660, 880], // rising two-note chime
  check: [660],
  pick: [660, 880, 1100],
};

function chime(kind: AlertKind): void {
  const c = audio();
  if (!c || c.state !== 'running') return; // not unlocked yet: stay silent rather than error
  const start = c.currentTime + 0.02;
  NOTES[kind].forEach((freq, i) => {
    const t = start + i * 0.16;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.32);
  });
}

export function playAlert(kind: AlertKind, prefs: { sound: boolean; vibrate: boolean }): void {
  if (prefs.vibrate) vibrate(kind);
  if (prefs.sound) chime(kind);
}
