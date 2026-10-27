/**
 * Per-device persistence (roster stats, last seat setup). Browser storage can be
 * unavailable (private mode, blocked site data), so every access is guarded and
 * the game works without it.
 */
import type { PlayerKind } from '@fungus/engine';

export interface RosterEntry {
  name: string;
  wins: number;
  losses: number;
}

export interface Seat {
  name: string;
  kind: PlayerKind | 'none';
}

export interface Saved {
  roster: RosterEntry[];
  seats: Seat[];
  timeLimit: number | null;
  sound: boolean;
  zoom: number;
}

const KEY = 'fungus.v1';

const DEFAULTS: Saved = {
  roster: [],
  seats: [
    { name: 'Player 1', kind: 'human' },
    { name: 'CPU 1', kind: 'cpu-classic' },
    { name: 'CPU 2', kind: 'cpu-classic' },
    { name: 'CPU 3', kind: 'cpu-classic' },
  ],
  timeLimit: null,
  sound: true,
  zoom: 1,
};

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const v = JSON.parse(raw) as Partial<Saved>;
    return {
      roster: Array.isArray(v.roster) ? v.roster : [],
      seats: Array.isArray(v.seats) && v.seats.length === 4 ? v.seats : structuredClone(DEFAULTS.seats),
      timeLimit: typeof v.timeLimit === 'number' ? v.timeLimit : null,
      sound: v.sound !== false,
      zoom: typeof v.zoom === 'number' ? v.zoom : 1,
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(v: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable — play on without saving */
  }
}

export function recordResult(names: string[], winner: string): void {
  const v = load();
  for (const name of names) {
    let e = v.roster.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!e) {
      e = { name, wins: 0, losses: 0 };
      v.roster.push(e);
    }
    if (name === winner) e.wins++;
    else e.losses++;
  }
  save(v);
}
