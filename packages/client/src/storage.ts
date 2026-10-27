/**
 * Per-device persistence (roster stats, last setup, preferences). Browser
 * storage can be unavailable (private mode, blocked site data), so every access
 * is guarded and the game works without it.
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
  /** Classic: always four seats (any may be 'none'). */
  seats: Seat[];
  /** Modern: 2–16 seats. */
  modernSeats: Seat[];
  rules: 'classic' | 'modern';
  boardSize: number;
  timeLimit: number | null;
  sound: boolean;
  uiScale: number;
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
  modernSeats: [
    { name: 'Player 1', kind: 'human' },
    { name: 'CPU 1', kind: 'cpu-classic' },
    { name: 'CPU 2', kind: 'cpu-classic' },
    { name: 'CPU 3', kind: 'cpu-classic' },
    { name: 'CPU 4', kind: 'cpu-classic' },
    { name: 'CPU 5', kind: 'cpu-classic' },
  ],
  rules: 'classic',
  boardSize: 20,
  timeLimit: null,
  sound: true,
  uiScale: 1,
};

const isSeat = (s: unknown): s is Seat =>
  !!s && typeof (s as Seat).name === 'string' && ['human', 'cpu-classic', 'cpu', 'none'].includes((s as Seat).kind);

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const v = JSON.parse(raw) as Partial<Saved>;
    const modern = Array.isArray(v.modernSeats) ? v.modernSeats.filter(isSeat).slice(0, 16) : [];
    return {
      roster: Array.isArray(v.roster) ? v.roster : [],
      seats: Array.isArray(v.seats) && v.seats.length === 4 && v.seats.every(isSeat) ? v.seats : structuredClone(DEFAULTS.seats),
      modernSeats: modern.length >= 2 ? modern : structuredClone(DEFAULTS.modernSeats),
      rules: v.rules === 'modern' ? 'modern' : 'classic',
      boardSize: typeof v.boardSize === 'number' ? v.boardSize : 20,
      timeLimit: typeof v.timeLimit === 'number' ? v.timeLimit : null,
      sound: v.sound !== false,
      uiScale: typeof v.uiScale === 'number' ? v.uiScale : 1,
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
