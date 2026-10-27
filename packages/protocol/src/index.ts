/**
 * Online protocol shared by client and server. JSON over one WebSocket.
 *
 * The server is authoritative: clients send intents, the server validates them
 * with the engine and broadcasts accepted actions. Every client replays the
 * same actions on the same seeded state, so the boards stay identical; a state
 * hash rides along with each action so a client can detect drift and resync.
 */
import {
  BOARD_SIZES,
  MAX_CLASSIC_PLAYERS,
  MAX_PLAYERS,
  classicConfig,
  minModernSize,
  modernConfig,
} from '@fungus/engine';
import type { Action, GameConfig, GameState, PlayerConfig, Pos, Speed } from '@fungus/engine';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const NAME_MAX = 16;
export const ROOM_CODE_LENGTH = 4;
/** No 0/O, 1/I/L — codes are read aloud and typed on phones. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TURN_LIMIT_MIN = 10;
export const TURN_LIMIT_MAX = 120;
export const TURN_LIMIT_DEFAULT = 30;
export const DISCONNECT_GRACE_MS = 60_000;

/** Fixed reactions — no free text, nothing to moderate. */
export const EMOTES = ['gg', 'nice', 'oops', 'wow', 'grr', 'yum'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_LABEL: Record<Emote, string> = {
  gg: 'gg',
  nice: 'Nice!',
  oops: 'Oops',
  wow: 'Whoa',
  grr: 'Grr',
  yum: 'Yum',
};

// ---------------------------------------------------------------- room settings

export type SeatSpec = 'open' | 'cpu' | 'closed';

export interface RoomSettings {
  rules: 'classic' | 'modern';
  boardSize: number;
  newTeeth: Speed;
  biteGrowth: Speed;
  /** Seconds per turn. Online games always have a limit so nobody can stall. */
  turnTimeLimit: number;
  public: boolean;
  /** One entry per seat. Classic: exactly 4 (closed = no player). Modern: 2–16, no closed. */
  seats: SeatSpec[];
}

export type SeatView =
  | { kind: 'open' }
  | { kind: 'closed' }
  | { kind: 'cpu' }
  | { kind: 'human'; name: string; connected: boolean; host: boolean; you: boolean };

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'ended';
  settings: RoomSettings;
  seats: SeatView[];
  /** People in the room without a seat. */
  watchers: number;
  youAreHost: boolean;
  yourSeat: number | null;
}

export interface RoomSummary {
  code: string;
  host: string;
  rules: 'classic' | 'modern';
  boardSize: number;
  humans: number;
  open: number;
  seats: number;
  phase: 'lobby' | 'playing' | 'ended';
}

// ---------------------------------------------------------------- messages

export type ClientMessage =
  | { t: 'hello'; v: number; name: string; token?: string }
  | { t: 'list' }
  | { t: 'create'; settings: RoomSettings }
  | { t: 'join'; code: string }
  | { t: 'quick' }
  | { t: 'leave' }
  | { t: 'sit'; seat: number }
  | { t: 'seat'; seat: number; kind: SeatSpec }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'start' }
  | { t: 'act'; seq: number; action: Action }
  | { t: 'resync' }
  | { t: 'emote'; id: Emote }
  | { t: 'ping' };

export interface GameSnapshot {
  state: GameState;
  /** Number of actions applied so far. */
  seq: number;
  /** Colour/pattern style for each engine player (seat index). */
  styles: number[];
  /** Your engine player index, or null when watching. */
  you: number | null;
  /** Milliseconds left on the current turn, or null. */
  timeLeft: number | null;
  /** Engine player indices currently played by a stand-in CPU. */
  standIns: number[];
}

export type ServerMessage =
  | { t: 'welcome'; id: string; token: string; name: string; room: string | null }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'room'; room: RoomView }
  | { t: 'left' }
  | { t: 'game'; game: GameSnapshot }
  | { t: 'applied'; seq: number; player: number; action: Action; hash: number; timeLeft: number | null; standIns: number[] }
  | { t: 'timer'; timeLeft: number | null }
  | { t: 'emote'; player: number; id: Emote }
  | { t: 'notice'; text: string }
  | { t: 'error'; code: ErrorCode; text: string }
  | { t: 'pong' };

export type ErrorCode =
  | 'bad-message'
  | 'version'
  | 'rate-limit'
  | 'no-room'
  | 'room-full'
  | 'not-host'
  | 'bad-settings'
  | 'not-your-turn'
  | 'illegal'
  | 'too-many-rooms'
  | 'in-progress'
  | 'server-full';

// ---------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const SPEEDS: Speed[] = ['veryslow', 'slow', 'normal', 'fast', 'veryfast'];

/** Trim, strip control/zero-width characters, collapse spaces, cap length. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return s.length ? s : null;
}

export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (s.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** Returns an error string, or null if the settings are valid. */
export function validateSettings(v: unknown): string | null {
  if (!isObj(v)) return 'settings missing';
  if (v.rules !== 'classic' && v.rules !== 'modern') return 'bad rules';
  if (!BOARD_SIZES.some((b) => b.size === v.boardSize)) return 'bad board size';
  if (!SPEEDS.includes(v.newTeeth as Speed) || !SPEEDS.includes(v.biteGrowth as Speed)) return 'bad speeds';
  if (!isInt(v.turnTimeLimit, TURN_LIMIT_MIN, TURN_LIMIT_MAX)) return 'bad turn limit';
  if (typeof v.public !== 'boolean') return 'bad public flag';
  if (!Array.isArray(v.seats)) return 'bad seats';
  const seats = v.seats as unknown[];
  if (!seats.every((s) => s === 'open' || s === 'cpu' || s === 'closed')) return 'bad seat';
  if (v.rules === 'classic') {
    if (seats.length !== MAX_CLASSIC_PLAYERS) return 'classic needs 4 seats';
  } else {
    if (seats.length < 2 || seats.length > MAX_PLAYERS) return 'bad seat count';
    if (seats.includes('closed')) return 'modern seats cannot be closed';
    if ((v.boardSize as number) < minModernSize(seats.length)) return 'board too small for players';
  }
  if (seats.filter((s) => s !== 'closed').length < 2) return 'need at least two seats';
  return null;
}

function validAction(v: unknown): v is Action {
  if (!isObj(v)) return false;
  const pos = (p: unknown): p is Pos => isObj(p) && isInt(p.r, -4, 200) && isInt(p.c, -4, 200);
  switch (v.type) {
    case 'pass':
      return true;
    case 'place':
      return isInt(v.rotation, 0, 3) && isInt(v.r, -4, 200) && isInt(v.c, -4, 200);
    case 'bite':
      return Array.isArray(v.cells) && v.cells.length >= 1 && v.cells.length <= 3 && v.cells.every(pos);
    default:
      // 'grow' is the classic CPU's move; humans never send it.
      return false;
  }
}

/** Parse and validate one client message. Returns null if it isn't well-formed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'hello':
      return isInt(v.v, 0, 1000) && typeof v.name === 'string' && (v.token === undefined || (typeof v.token === 'string' && v.token.length <= 64))
        ? { t: 'hello', v: v.v, name: v.name, token: v.token as string | undefined }
        : null;
    case 'list':
    case 'quick':
    case 'leave':
    case 'start':
    case 'resync':
    case 'ping':
      return { t: v.t };
    case 'create':
    case 'settings':
      return validateSettings(v.settings) === null ? { t: v.t, settings: v.settings as unknown as RoomSettings } : null;
    case 'join':
      return typeof v.code === 'string' ? { t: 'join', code: v.code } : null;
    case 'sit':
      return isInt(v.seat, 0, MAX_PLAYERS - 1) ? { t: 'sit', seat: v.seat } : null;
    case 'seat':
      return isInt(v.seat, 0, MAX_PLAYERS - 1) && (v.kind === 'open' || v.kind === 'cpu' || v.kind === 'closed')
        ? { t: 'seat', seat: v.seat, kind: v.kind }
        : null;
    case 'act':
      return isInt(v.seq, 0, 1e9) && validAction(v.action) ? { t: 'act', seq: v.seq, action: v.action } : null;
    case 'emote':
      return EMOTES.includes(v.id as Emote) ? { t: 'emote', id: v.id as Emote } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- config

/**
 * Build the engine config for a room. `players` lists the engine players in
 * seat order (closed seats skipped); `styles` maps each to its seat index so
 * colours follow seats.
 */
export function roomConfig(settings: RoomSettings, players: PlayerConfig[]): GameConfig {
  const base = { turnTimeLimit: settings.turnTimeLimit };
  return settings.rules === 'classic'
    ? classicConfig(players, { ...base, size: settings.boardSize })
    : modernConfig(players, settings.boardSize, base, { newTeeth: settings.newTeeth, biteGrowth: settings.biteGrowth });
}

export function defaultRoomSettings(): RoomSettings {
  return {
    rules: 'classic',
    boardSize: 20,
    newTeeth: 'normal',
    biteGrowth: 'normal',
    turnTimeLimit: TURN_LIMIT_DEFAULT,
    public: true,
    seats: ['open', 'open', 'cpu', 'cpu'],
  };
}
