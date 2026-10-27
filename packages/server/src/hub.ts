/**
 * The game hub: sessions, rooms and authoritative games. Transport-agnostic —
 * it talks to clients through the `Conn` interface so tests can drive it
 * without real sockets.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  applyAction,
  classicCpuTurn,
  createGame,
  greedyCpuTurn,
  hasAnyMove,
  stateHash,
} from '@fungus/engine';
import type { Action, GameState, PlayerConfig } from '@fungus/engine';
import {
  DISCONNECT_GRACE_MS,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  cleanCode,
  cleanName,
  defaultRoomSettings,
  roomConfig,
} from '@fungus/protocol';
import type { ClientMessage, Emote, ErrorCode, GameSnapshot, RoomSettings, RoomSummary, RoomView, SeatSpec, SeatView, ServerMessage } from '@fungus/protocol';

export interface Conn {
  send(msg: ServerMessage): void;
  close(): void;
}

export interface HubOptions {
  maxRooms?: number;
  maxSessions?: number;
  /** Delay before a CPU moves (ms). */
  cpuThinkMs?: number;
  cpuStepMs?: number;
  graceMs?: number;
  /** Lobby/ended rooms with nobody connected are removed after this long. */
  idleRoomMs?: number;
  /** Disconnected sessions not in a room are forgotten after this long. */
  idleSessionMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
  /** Tests only: use this turn length (ms) instead of the room's setting. */
  turnMsOverride?: number;
}

interface Session {
  id: string;
  token: string;
  name: string;
  conn: Conn | null;
  room: Room | null;
  lastSeen: number;
  /** Token bucket for message rate limiting. */
  tokens: number;
  refill: number;
  lastEmote: number;
}

interface Seat {
  spec: SeatSpec;
  occupant: string | null; // session id
}

interface Game {
  state: GameState;
  seq: number;
  /** engine index → seat index */
  seatOf: number[];
  /** engine index → session id (null for CPU seats) */
  owner: (string | null)[];
  standIns: Set<number>;
  graceTimers: Map<number, NodeJS.Timeout>;
  turnTimer: NodeJS.Timeout | null;
  cpuTimer: NodeJS.Timeout | null;
  deadline: number | null;
  /** True while nobody is connected (nothing runs until someone returns). */
  paused: boolean;
}

interface Room {
  code: string;
  hostId: string;
  settings: RoomSettings;
  seats: Seat[];
  members: Set<string>;
  phase: 'lobby' | 'playing' | 'ended';
  game: Game | null;
  /** Seat specs as they were before the last start (so a rematch restores open seats). */
  lobbySpecs: SeatSpec[];
  idleSince: number | null;
}

const RATE_CAPACITY = 40;
const RATE_PER_SEC = 12;
const EMOTE_GAP_MS = 1500;

export class Hub {
  private sessions = new Map<string, Session>(); // by id
  private byToken = new Map<string, Session>();
  private rooms = new Map<string, Room>();
  private o: Required<HubOptions>;
  private sweeper: NodeJS.Timeout;

  constructor(opts: HubOptions = {}) {
    this.o = {
      maxRooms: 200,
      maxSessions: 2000,
      cpuThinkMs: 500,
      cpuStepMs: 300,
      graceMs: DISCONNECT_GRACE_MS,
      idleRoomMs: 10 * 60_000,
      idleSessionMs: 30 * 60_000,
      now: () => Date.now(),
      log: () => {},
      turnMsOverride: 0,
      ...opts,
    };
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  shutdown(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) this.stopGameTimers(room);
  }

  stats(): { sessions: number; rooms: number; playing: number } {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.phase === 'playing') playing++;
    return { sessions: this.sessions.size, rooms: this.rooms.size, playing };
  }

  // ------------------------------------------------------------ connections

  /** A new socket. Returns a handle the transport calls on messages/close. */
  connect(conn: Conn): { message: (m: ClientMessage) => void; close: () => void } {
    let session: Session | null = null;
    return {
      message: (m) => {
        if (!session) {
          if (m.t !== 'hello') return this.err(conn, 'bad-message', 'Say hello first.');
          session = this.hello(conn, m);
          return;
        }
        if (!this.allow(session)) return this.err(conn, 'rate-limit', 'Slow down a little.');
        session.lastSeen = this.o.now();
        this.handle(session, m);
      },
      close: () => {
        if (session && session.conn === conn) this.disconnected(session);
      },
    };
  }

  private hello(conn: Conn, m: Extract<ClientMessage, { t: 'hello' }>): Session | null {
    if (m.v !== PROTOCOL_VERSION) {
      this.err(conn, 'version', 'This page is out of date — reload to get the latest version.');
      conn.close();
      return null;
    }
    const name = cleanName(m.name) ?? 'Player';
    let s = m.token ? this.byToken.get(m.token) : undefined;
    if (s) {
      // Reconnect: the newest connection wins.
      if (s.conn && s.conn !== conn) s.conn.close();
      s.conn = conn;
      s.name = name;
    } else {
      if (this.sessions.size >= this.o.maxSessions) {
        this.err(conn, 'server-full', 'The server is full right now. Try again in a bit.');
        conn.close();
        return null;
      }
      s = {
        id: randomBytes(9).toString('base64url'),
        token: randomBytes(24).toString('base64url'),
        name,
        conn,
        room: null,
        lastSeen: this.o.now(),
        tokens: RATE_CAPACITY,
        refill: this.o.now(),
        lastEmote: 0,
      };
      this.sessions.set(s.id, s);
      this.byToken.set(s.token, s);
    }
    s.lastSeen = this.o.now();
    conn.send({ t: 'welcome', id: s.id, token: s.token, name: s.name, room: s.room?.code ?? null });
    if (s.room) this.reconnected(s, s.room);
    return s;
  }

  private allow(s: Session): boolean {
    const now = this.o.now();
    s.tokens = Math.min(RATE_CAPACITY, s.tokens + ((now - s.refill) / 1000) * RATE_PER_SEC);
    s.refill = now;
    if (s.tokens < 1) return false;
    s.tokens--;
    return true;
  }

  private disconnected(s: Session): void {
    s.conn = null;
    s.lastSeen = this.o.now();
    const room = s.room;
    if (!room) return;
    if (room.phase === 'playing' && room.game) {
      const g = room.game;
      const p = g.owner.indexOf(s.id);
      if (p >= 0 && g.state.players[p]!.alive && !g.standIns.has(p)) {
        this.notice(room, `${s.name} disconnected — a CPU takes over in ${Math.round(this.o.graceMs / 1000)} seconds unless they return.`);
        g.graceTimers.set(
          p,
          setTimeout(() => {
            g.graceTimers.delete(p);
            if (s.conn || room.game !== g) return;
            g.standIns.add(p);
            this.notice(room, `A CPU is playing for ${s.name} until they come back.`);
            this.broadcastTimer(room);
            if (g.state.current === p) this.scheduleTurn(room);
          }, this.o.graceMs),
        );
      }
    }
    this.broadcastRoom(room);
    this.touchIdle(room);
  }

  private reconnected(s: Session, room: Room): void {
    room.idleSince = null;
    const g = room.game;
    if (g) {
      const p = g.owner.indexOf(s.id);
      if (p >= 0) {
        const t = g.graceTimers.get(p);
        if (t) clearTimeout(t);
        g.graceTimers.delete(p);
        if (g.standIns.delete(p)) this.notice(room, `${s.name} is back.`);
      }
    }
    this.broadcastRoom(room);
    if (g) {
      if (g.paused && room.phase === 'playing') this.scheduleTurn(room);
      this.sendGame(room, s);
    }
  }

  // ------------------------------------------------------------ dispatch

  private handle(s: Session, m: ClientMessage): void {
    switch (m.t) {
      case 'hello':
        return; // already greeted
      case 'ping':
        return s.conn?.send({ t: 'pong' });
      case 'list':
        return s.conn?.send({ t: 'rooms', rooms: this.listRooms() });
      case 'create':
        return this.create(s, m.settings);
      case 'join':
        return this.join(s, m.code);
      case 'quick':
        return this.quick(s);
      case 'leave':
        return this.leave(s);
      case 'sit':
        return this.sit(s, m.seat);
      case 'seat':
        return this.setSeat(s, m.seat, m.kind);
      case 'settings':
        return this.updateSettings(s, m.settings);
      case 'start':
        return this.start(s);
      case 'act':
        return this.act(s, m.seq, m.action);
      case 'resync':
        return s.room?.game ? this.sendGame(s.room, s) : undefined;
      case 'emote':
        return this.emote(s, m.id);
    }
  }

  private err(conn: Conn | null, code: ErrorCode, text: string): void {
    conn?.send({ t: 'error', code, text });
  }

  // ------------------------------------------------------------ rooms

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  private create(s: Session, settings: RoomSettings): void {
    if (this.rooms.size >= this.o.maxRooms) return this.err(s.conn, 'too-many-rooms', 'Too many games are running right now. Try again soon.');
    this.leave(s, true);
    const room: Room = {
      code: this.newCode(),
      hostId: s.id,
      settings: structuredClone(settings),
      seats: settings.seats.map((spec) => ({ spec, occupant: null })),
      members: new Set(),
      phase: 'lobby',
      game: null,
      lobbySpecs: [...settings.seats],
      idleSince: null,
    };
    this.rooms.set(room.code, room);
    this.o.log(`room ${room.code} created by ${s.name}`);
    this.enter(s, room);
  }

  private join(s: Session, rawCode: string): void {
    const code = cleanCode(rawCode);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) return this.err(s.conn, 'no-room', 'No game with that code. Check the letters and try again.');
    if (s.room === room) return this.reconnected(s, room);
    this.leave(s, true);
    this.enter(s, room);
  }

  /** Join the busiest public lobby with a free seat, or open a new public room. */
  private quick(s: Session): void {
    let best: Room | null = null;
    let bestHumans = -1;
    for (const r of this.rooms.values()) {
      if (!r.settings.public || r.phase !== 'lobby' || r === s.room || this.humansWatching(r) === 0) continue;
      if (!r.seats.some((x) => x.spec === 'open' && !x.occupant)) continue;
      const humans = r.seats.filter((x) => x.occupant).length;
      if (humans > bestHumans) {
        best = r;
        bestHumans = humans;
      }
    }
    if (best) {
      this.leave(s, true);
      this.enter(s, best);
    } else this.create(s, { ...defaultRoomSettings(), seats: ['open', 'open', 'open', 'open'] });
  }

  private enter(s: Session, room: Room): void {
    room.members.add(s.id);
    room.idleSince = null;
    s.room = room;
    if (room.phase === 'lobby') {
      const free = room.seats.findIndex((x) => x.spec === 'open' && !x.occupant);
      if (free >= 0) room.seats[free]!.occupant = s.id;
    }
    this.broadcastRoom(room);
    if (room.game) this.sendGame(room, s);
  }

  private leave(s: Session, quiet = false): void {
    const room = s.room;
    if (!room) return;
    room.members.delete(s.id);
    s.room = null;
    for (const seat of room.seats) if (seat.occupant === s.id) seat.occupant = null;
    const g = room.game;
    if (g && room.phase === 'playing') {
      const p = g.owner.indexOf(s.id);
      if (p >= 0 && g.state.players[p]!.alive) {
        // Leaving for good: a CPU plays their fungus right away.
        g.owner[p] = null;
        g.standIns.add(p);
        this.notice(room, `${s.name} left — a CPU is playing their fungus.`);
        if (g.state.current === p) this.scheduleTurn(room);
      }
    }
    if (room.hostId === s.id) {
      const next = [...room.members].find((id) => this.sessions.get(id)?.conn);
      if (next) room.hostId = next;
    }
    if (!quiet) s.conn?.send({ t: 'left' });
    if (room.members.size === 0) this.closeRoom(room);
    else {
      this.broadcastRoom(room);
      this.touchIdle(room);
    }
  }

  private closeRoom(room: Room): void {
    this.stopGameTimers(room);
    this.rooms.delete(room.code);
    for (const id of room.members) {
      const m = this.sessions.get(id);
      if (m && m.room === room) {
        m.room = null;
        m.conn?.send({ t: 'left' });
      }
    }
    this.o.log(`room ${room.code} closed`);
  }

  private isHost(s: Session): Room | null {
    const room = s.room;
    if (!room) return null;
    if (room.hostId !== s.id) {
      this.err(s.conn, 'not-host', 'Only the host can do that.');
      return null;
    }
    return room;
  }

  private sit(s: Session, seat: number): void {
    const room = s.room;
    if (!room || room.phase !== 'lobby') return;
    const target = room.seats[seat];
    if (!target || target.spec !== 'open' || target.occupant) return this.err(s.conn, 'room-full', 'That seat is taken.');
    for (const x of room.seats) if (x.occupant === s.id) x.occupant = null;
    target.occupant = s.id;
    this.broadcastRoom(room);
  }

  private setSeat(s: Session, seat: number, spec: SeatSpec): void {
    const room = this.isHost(s);
    if (!room || room.phase !== 'lobby') return;
    const target = room.seats[seat];
    if (!target) return;
    if (spec === 'closed' && room.settings.rules !== 'classic') return this.err(s.conn, 'bad-settings', 'Modern seats can’t be closed — remove the seat instead.');
    const next = room.seats.map((x, i) => (i === seat ? spec : x.spec));
    if (next.filter((x) => x !== 'closed').length < 2) return this.err(s.conn, 'bad-settings', 'A game needs at least two seats.');
    // Changing a seat away from open moves its player to watching.
    if (spec !== 'open') target.occupant = null;
    target.spec = spec;
    room.settings.seats = room.seats.map((x) => x.spec);
    this.broadcastRoom(room);
  }

  private updateSettings(s: Session, settings: RoomSettings): void {
    const room = this.isHost(s);
    if (!room) return;
    if (room.phase === 'playing') return this.err(s.conn, 'in-progress', 'Settings are locked while a game is running.');
    const old = room.seats;
    room.settings = structuredClone(settings);
    room.seats = settings.seats.map((spec, i) => ({ spec, occupant: spec === 'open' ? (old[i]?.occupant ?? null) : null }));
    // Anyone who lost their seat but is still here can take another free one.
    for (const id of room.members) {
      if (room.seats.some((x) => x.occupant === id)) continue;
      const free = room.seats.findIndex((x) => x.spec === 'open' && !x.occupant);
      if (free >= 0 && this.sessions.get(id)?.conn) room.seats[free]!.occupant = id;
    }
    room.lobbySpecs = [...settings.seats];
    this.broadcastRoom(room);
  }

  private listRooms(): RoomSummary[] {
    const out: RoomSummary[] = [];
    for (const r of this.rooms.values()) {
      // Abandoned rooms (nobody connected) wait quietly to be swept, unlisted.
      if (!r.settings.public || r.phase === 'ended' || this.humansWatching(r) === 0) continue;
      out.push({
        code: r.code,
        host: this.sessions.get(r.hostId)?.name ?? '—',
        rules: r.settings.rules,
        boardSize: r.settings.boardSize,
        humans: r.seats.filter((x) => x.occupant).length,
        open: r.phase === 'lobby' ? r.seats.filter((x) => x.spec === 'open' && !x.occupant).length : 0,
        seats: r.seats.filter((x) => x.spec !== 'closed').length,
        phase: r.phase,
      });
    }
    return out.sort((a, b) => Number(a.phase !== 'lobby') - Number(b.phase !== 'lobby') || b.humans - a.humans).slice(0, 50);
  }

  // ------------------------------------------------------------ views

  private view(room: Room, viewer: Session): RoomView {
    const seats: SeatView[] = room.seats.map((x) => {
      if (x.occupant) {
        const o = this.sessions.get(x.occupant);
        return { kind: 'human', name: o?.name ?? '?', connected: !!o?.conn, host: x.occupant === room.hostId, you: x.occupant === viewer.id };
      }
      return { kind: x.spec === 'open' ? 'open' : x.spec };
    });
    const seated = new Set(room.seats.map((x) => x.occupant).filter(Boolean));
    let watchers = 0;
    for (const id of room.members) if (!seated.has(id)) watchers++;
    const yourSeat = room.seats.findIndex((x) => x.occupant === viewer.id);
    return {
      code: room.code,
      phase: room.phase,
      settings: room.settings,
      seats,
      watchers,
      youAreHost: room.hostId === viewer.id,
      yourSeat: yourSeat >= 0 ? yourSeat : null,
    };
  }

  private broadcastRoom(room: Room): void {
    for (const id of room.members) {
      const m = this.sessions.get(id);
      m?.conn?.send({ t: 'room', room: this.view(room, m) });
    }
  }

  private notice(room: Room, text: string): void {
    this.send(room, { t: 'notice', text });
  }

  private send(room: Room, msg: ServerMessage): void {
    for (const id of room.members) this.sessions.get(id)?.conn?.send(msg);
  }

  private timeLeft(g: Game): number | null {
    return g.deadline === null ? null : Math.max(0, g.deadline - this.o.now());
  }

  private sendGame(room: Room, s: Session): void {
    const g = room.game;
    if (!g) return;
    const you = g.owner.indexOf(s.id);
    const game: GameSnapshot = {
      state: g.state,
      seq: g.seq,
      styles: g.seatOf,
      you: you >= 0 ? you : null,
      timeLeft: this.timeLeft(g),
      standIns: [...g.standIns],
    };
    s.conn?.send({ t: 'game', game });
  }

  private broadcastTimer(room: Room): void {
    const g = room.game;
    if (g) this.send(room, { t: 'timer', timeLeft: this.timeLeft(g) });
  }

  private emote(s: Session, id: Emote): void {
    const room = s.room;
    const g = room?.game;
    if (!room || !g) return;
    const now = this.o.now();
    if (now - s.lastEmote < EMOTE_GAP_MS) return;
    s.lastEmote = now;
    const p = g.owner.indexOf(s.id);
    if (p >= 0) this.send(room, { t: 'emote', player: p, id });
  }

  // ------------------------------------------------------------ the game

  private start(s: Session): void {
    const room = this.isHost(s);
    if (!room) return;
    if (room.phase === 'ended') {
      // Back to the lobby for a rematch with the same seats.
      this.stopGameTimers(room);
      room.phase = 'lobby';
      room.game = null;
      room.seats = room.lobbySpecs.map((spec, i) => ({ spec, occupant: spec === 'open' ? (room.seats[i]?.occupant ?? null) : null }));
      for (const seat of room.seats) if (seat.occupant && !this.sessions.get(seat.occupant)?.conn) seat.occupant = null;
      room.settings.seats = [...room.lobbySpecs];
      this.broadcastRoom(room);
      return;
    }
    if (room.phase !== 'lobby') return;
    room.lobbySpecs = room.seats.map((x) => x.spec);
    const players: PlayerConfig[] = [];
    const seatOf: number[] = [];
    const owner: (string | null)[] = [];
    let cpuN = 0;
    room.seats.forEach((seat, i) => {
      if (seat.spec === 'closed') return;
      const occ = seat.occupant ? this.sessions.get(seat.occupant) : undefined;
      // Unfilled open seats become CPUs.
      if (occ) players.push({ name: occ.name, kind: 'human' });
      else players.push({ name: `CPU ${++cpuN}`, kind: 'cpu-classic' });
      seatOf.push(i);
      owner.push(occ ? occ.id : null);
    });
    if (players.length < 2) return this.err(s.conn, 'bad-settings', 'A game needs at least two seats.');
    // Names must be distinct so the scoreboard and messages make sense.
    const seen = new Map<string, number>();
    for (const p of players) {
      const k = p.name.toLowerCase();
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      if (n > 1) p.name = `${p.name} ${n}`.slice(0, 18);
    }
    let state: GameState;
    try {
      state = createGame(roomConfig(room.settings, players), randomInt(2 ** 32));
    } catch (e) {
      return this.err(s.conn, 'bad-settings', String((e as Error).message));
    }
    for (const seat of room.seats) if (seat.spec === 'open' && !seat.occupant) seat.spec = 'cpu';
    room.game = { state, seq: 0, seatOf, owner, standIns: new Set(), graceTimers: new Map(), turnTimer: null, cpuTimer: null, deadline: null, paused: false };
    room.phase = 'playing';
    this.o.log(`room ${room.code} started: ${players.length} players, ${room.settings.rules} ${room.settings.boardSize}`);
    // Seated players who are offline right now start their grace period immediately.
    room.game.owner.forEach((id, p) => {
      const o = id ? this.sessions.get(id) : undefined;
      if (o && !o.conn) this.disconnected(o);
      void p;
    });
    this.broadcastRoom(room);
    for (const id of room.members) {
      const m = this.sessions.get(id);
      if (m) this.sendGame(room, m);
    }
    this.scheduleTurn(room);
  }

  private stopGameTimers(room: Room): void {
    const g = room.game;
    if (!g) return;
    if (g.turnTimer) clearTimeout(g.turnTimer);
    if (g.cpuTimer) clearTimeout(g.cpuTimer);
    for (const t of g.graceTimers.values()) clearTimeout(t);
    g.graceTimers.clear();
    g.turnTimer = g.cpuTimer = null;
  }

  /** Decide who moves next and arm the right timer. */
  private scheduleTurn(room: Room): void {
    const g = room.game;
    if (!g) return;
    if (g.turnTimer) clearTimeout(g.turnTimer);
    if (g.cpuTimer) clearTimeout(g.cpuTimer);
    g.turnTimer = g.cpuTimer = null;
    g.deadline = null;
    const s = g.state;
    if (s.winner !== null) {
      room.phase = 'ended';
      this.stopGameTimers(room);
      this.broadcastRoom(room);
      this.touchIdle(room);
      return;
    }
    // Nobody connected: pause instead of letting CPUs play to an empty room.
    // reconnected() resumes it.
    if (this.humansWatching(room) === 0) {
      g.paused = true;
      return;
    }
    g.paused = false;
    const p = s.current;
    const pl = s.players[p]!;
    const cpu = pl.kind === 'cpu-classic' || g.standIns.has(p) || g.owner[p] === null;
    if (cpu) {
      const plan = () => (pl.kind === 'cpu-classic' ? classicCpuTurn(g.state) : greedyCpuTurn(g.state));
      g.cpuTimer = setTimeout(() => this.runCpu(room, g, plan()), this.o.cpuThinkMs);
      this.broadcastTimer(room);
      return;
    }
    if (!hasAnyMove(s, p)) {
      g.cpuTimer = setTimeout(() => this.apply(room, p, { type: 'pass' }), 900);
      this.broadcastTimer(room);
      return;
    }
    const limit = this.o.turnMsOverride || room.settings.turnTimeLimit * 1000;
    g.deadline = this.o.now() + limit;
    g.turnTimer = setTimeout(() => {
      if (room.game === g && g.state.current === p) {
        this.notice(room, `${pl.name} ran out of time.`);
        this.apply(room, p, { type: 'pass' });
      }
    }, limit);
    this.broadcastTimer(room);
  }

  private humansWatching(room: Room): number {
    let n = 0;
    for (const id of room.members) if (this.sessions.get(id)?.conn) n++;
    return n;
  }

  private runCpu(room: Room, g: Game, queue: Action[]): void {
    if (room.game !== g) return;
    const p = g.state.current;
    const a = queue.shift();
    if (!a) return;
    const ok = this.apply(room, p, a);
    if (!ok) {
      this.o.log(`room ${room.code}: CPU action rejected, passing`);
      this.apply(room, p, { type: 'pass' });
      return;
    }
    if (a.type === 'bite' && g.state.current === p && g.state.winner === null)
      g.cpuTimer = setTimeout(() => this.runCpu(room, g, queue), this.o.cpuStepMs);
  }

  /** Apply an action as player p and tell everyone. Returns false if illegal. */
  private apply(room: Room, p: number, action: Action): boolean {
    const g = room.game;
    if (!g || g.state.current !== p) return false;
    const r = applyAction(g.state, p, action);
    if (!r.ok) return false;
    g.state = r.state;
    g.seq++;
    const turnEnded = action.type !== 'bite' || r.state.winner !== null;
    if (turnEnded) {
      if (g.turnTimer) clearTimeout(g.turnTimer);
      g.turnTimer = null;
      g.deadline = null;
    }
    this.send(room, { t: 'applied', seq: g.seq, player: p, action, hash: stateHash(g.state), timeLeft: this.timeLeft(g), standIns: [...g.standIns] });
    if (turnEnded) this.scheduleTurn(room);
    return true;
  }

  private act(s: Session, seq: number, action: Action): void {
    const room = s.room;
    const g = room?.game;
    if (!room || !g || room.phase !== 'playing') return this.err(s.conn, 'illegal', 'There’s no game running.');
    const p = g.owner.indexOf(s.id);
    if (p < 0 || g.state.current !== p || g.standIns.has(p)) return this.err(s.conn, 'not-your-turn', 'It isn’t your turn.');
    if (seq !== g.seq) {
      // The client is behind; bring it up to date rather than guess.
      this.sendGame(room, s);
      return;
    }
    const r = applyAction(g.state, p, action);
    if (!r.ok) return this.err(s.conn, 'illegal', r.error);
    this.apply(room, p, action);
  }

  // ------------------------------------------------------------ cleanup

  private touchIdle(room: Room): void {
    const anyone = [...room.members].some((id) => this.sessions.get(id)?.conn);
    room.idleSince = anyone ? null : (room.idleSince ?? this.o.now());
  }

  /** Remove abandoned rooms and forgotten sessions. */
  sweep(): void {
    const now = this.o.now();
    for (const room of [...this.rooms.values()]) {
      this.touchIdle(room);
      if (room.idleSince !== null && now - room.idleSince > this.o.idleRoomMs) this.closeRoom(room);
    }
    for (const s of [...this.sessions.values()]) {
      if (!s.conn && !s.room && now - s.lastSeen > this.o.idleSessionMs) {
        this.sessions.delete(s.id);
        this.byToken.delete(s.token);
      }
    }
  }
}
