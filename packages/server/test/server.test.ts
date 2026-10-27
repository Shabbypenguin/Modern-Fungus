import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { applyAction, legalPlacements, stateHash } from '@fungus/engine';
import type { GameState } from '@fungus/engine';
import { PROTOCOL_VERSION, defaultRoomSettings } from '@fungus/protocol';
import type { ClientMessage, RoomSettings, ServerMessage } from '@fungus/protocol';
import { startServer } from '../src/server.js';
import type { Running, ServerOptions } from '../src/server.js';

class Client {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  /** Local replay of the game, like the real client does. */
  state: GameState | null = null;
  seq = 0;
  you: number | null = null;
  hashMismatch = 0;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url.replace('http', 'ws') + '/ws', { headers });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.t === 'game') {
        this.state = m.game.state;
        this.seq = m.game.seq;
        this.you = m.game.you;
      } else if (m.t === 'applied' && this.state) {
        const r = applyAction(this.state, m.player, m.action);
        if (!r.ok || stateHash(r.state) !== m.hash) this.hashMismatch++;
        else {
          this.state = r.state;
          this.seq = m.seq;
        }
      }
      this.inbox.push(m);
      for (const w of [...this.waiters])
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
    });
  }
  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }
  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }
  waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 3000) {
    const hit = this.inbox.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
    if (hit) {
      this.inbox.splice(this.inbox.indexOf(hit), 1);
      return Promise.resolve(hit as Extract<ServerMessage, { t: T }>);
    }
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), ms);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          this.inbox.splice(this.inbox.indexOf(m), 1);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }
  clear(): void {
    this.inbox = [];
  }
  close(): void {
    this.ws.close();
  }
}

let srv: Running;
const clients: Client[] = [];
async function client(name: string, token?: string): Promise<Client> {
  const c = new Client(srv.url);
  clients.push(c);
  await c.open();
  c.send({ t: 'hello', v: PROTOCOL_VERSION, name, token });
  await c.waitFor('welcome');
  return c;
}
const two = (rules: Partial<RoomSettings> = {}): RoomSettings => ({ ...defaultRoomSettings(), seats: ['open', 'open', 'closed', 'closed'], ...rules });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot(extra: ServerOptions = {}) {
  srv = await startServer({ port: 0, cpuThinkMs: 5, cpuStepMs: 5, graceMs: 250, turnMsOverride: 600, ...extra });
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await srv?.close();
});

describe('sessions', () => {
  beforeEach(() => boot());
  it('greets with a token and reconnects to the same identity', async () => {
    const a = await client('Shabby');
    a.send({ t: 'ping' });
    await a.waitFor('pong');
    const c1 = new Client(srv.url);
    clients.push(c1);
    await c1.open();
    c1.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Shabby' });
    const first = await c1.waitFor('welcome');
    const c2 = new Client(srv.url);
    clients.push(c2);
    await c2.open();
    c2.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Shabby', token: first.token });
    const again = await c2.waitFor('welcome');
    expect(again.id).toBe(first.id);
  });
  it('rejects an old protocol version', async () => {
    const c = new Client(srv.url);
    clients.push(c);
    await c.open();
    c.send({ t: 'hello', v: 999, name: 'x' });
    expect((await c.waitFor('error')).code).toBe('version');
  });
  it('cleans names', async () => {
    const c = new Client(srv.url);
    clients.push(c);
    await c.open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: '  Bad​Name\u0007  ' });
    expect((await c.waitFor('welcome')).name).toBe('BadName');
  });
});

describe('rooms and a full networked game', () => {
  beforeEach(() => boot());

  it('host creates, friend joins by code, both replay identical boards', async () => {
    const host = await client('Host');
    const friend = await client('Friend');
    host.send({ t: 'create', settings: two() });
    const view = await host.waitFor('room');
    expect(view.room.youAreHost).toBe(true);
    expect(view.room.yourSeat).toBe(0);
    friend.send({ t: 'join', code: view.room.code.toLowerCase() });
    const fv = await friend.waitFor('room');
    expect(fv.room.yourSeat).toBe(1);

    // Only the host may start.
    friend.send({ t: 'start' });
    expect((await friend.waitFor('error')).code).toBe('not-host');
    host.send({ t: 'start' });
    await host.waitFor('game');
    await friend.waitFor('game');
    expect(host.you).toBe(0);
    expect(friend.you).toBe(1);

    // Play 12 turns alternating, each player placing its first legal move.
    for (let turn = 0; turn < 12; turn++) {
      const mover = host.state!.current === 0 ? host : friend;
      const move = legalPlacements(mover.state!, mover.state!.current)[0];
      mover.send({ t: 'act', seq: mover.seq, action: move ? { type: 'place', ...move } : { type: 'pass' } });
      await host.waitFor('applied', (m) => m.seq === turn + 1);
      await friend.waitFor('applied', (m) => m.seq === turn + 1);
    }
    expect(host.hashMismatch + friend.hashMismatch).toBe(0);
    expect(stateHash(host.state!)).toBe(stateHash(friend.state!));
  });

  it('rejects moves out of turn, illegal moves, and stale moves', async () => {
    const host = await client('Host');
    const friend = await client('Friend');
    host.send({ t: 'create', settings: two() });
    const v = await host.waitFor('room');
    friend.send({ t: 'join', code: v.room.code });
    await friend.waitFor('room');
    host.send({ t: 'start' });
    await host.waitFor('game');
    await friend.waitFor('game');
    const mover = host.state!.current === 0 ? host : friend;
    const other = mover === host ? friend : host;
    other.send({ t: 'act', seq: other.seq, action: { type: 'pass' } });
    expect((await other.waitFor('error')).code).toBe('not-your-turn');
    mover.send({ t: 'act', seq: mover.seq, action: { type: 'place', rotation: 0, r: 0, c: 0 } });
    expect((await mover.waitFor('error')).code).toBe('illegal');
    mover.send({ t: 'act', seq: mover.seq + 5, action: { type: 'pass' } });
    await mover.waitFor('game'); // stale → full resync instead of guessing
  });

  it('turn timer passes for a player who runs out of time', async () => {
    const host = await client('Host');
    const friend = await client('Friend');
    host.send({ t: 'create', settings: two() });
    const v = await host.waitFor('room');
    friend.send({ t: 'join', code: v.room.code });
    host.send({ t: 'start' });
    await host.waitFor('game');
    const first = host.state!.current;
    const m = await host.waitFor('applied', () => true, 2000);
    expect(m.player).toBe(first);
    expect(m.action.type).toBe('pass');
  });

  it('a CPU stands in after the grace period and hands the seat back on return', async () => {
    const host = await client('Host');
    const friend = await client('Friend');
    host.send({ t: 'create', settings: two() });
    const v = await host.waitFor('room');
    friend.send({ t: 'join', code: v.room.code });
    host.send({ t: 'start' });
    await friend.waitFor('game');
    friend.close();
    await host.waitFor('notice', (n) => /disconnected/.test(n.text));
    await host.waitFor('notice', (n) => /CPU is playing/.test(n.text), 2000);
    // The stand-in plays the friend's turns using human rules (place / bite / pass).
    const cpuMove = await host.waitFor('applied', (m) => m.player === 1, 4000);
    expect(['place', 'bite', 'pass']).toContain(cpuMove.action.type);
    expect(cpuMove.standIns).toContain(1);
  });

  it('reconnecting with the token reclaims the seat', async () => {
    const host = await client('Host');
    const c = new Client(srv.url);
    clients.push(c);
    await c.open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Friend' });
    const fw = await c.waitFor('welcome');
    host.send({ t: 'create', settings: two() });
    const v = await host.waitFor('room');
    c.send({ t: 'join', code: v.room.code });
    host.send({ t: 'start' });
    await c.waitFor('game');
    c.close();
    await host.waitFor('notice', (n) => /CPU is playing/.test(n.text), 2000);
    const back = new Client(srv.url);
    clients.push(back);
    await back.open();
    back.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Friend', token: fw.token });
    const w = await back.waitFor('welcome');
    expect(w.room).toBe(v.room.code);
    const g = await back.waitFor('game');
    expect(g.game.you).toBe(1);
    expect(g.game.standIns).not.toContain(1);
    await host.waitFor('notice', (n) => /is back/.test(n.text));
  });

  it('quick play joins an open public room, and the room list shows it', async () => {
    const host = await client('Host');
    host.send({ t: 'create', settings: { ...defaultRoomSettings(), seats: ['open', 'open', 'open', 'cpu'] } });
    const v = await host.waitFor('room');
    const q = await client('Quick');
    q.send({ t: 'list' });
    const list = await q.waitFor('rooms');
    expect(list.rooms.map((r) => r.code)).toContain(v.room.code);
    q.send({ t: 'quick' });
    const qv = await q.waitFor('room');
    expect(qv.room.code).toBe(v.room.code);
    expect(qv.room.yourSeat).toBe(1);
  });

  it('abandoned rooms (nobody connected) are not listed or quick-joined', async () => {
    const host = await client('Gone');
    host.send({ t: 'create', settings: { ...defaultRoomSettings(), seats: ['open', 'open', 'open', 'open'] } });
    const v = await host.waitFor('room');
    host.close();
    await new Promise((r) => setTimeout(r, 100));
    const q = await client('Quick');
    q.send({ t: 'list' });
    expect((await q.waitFor('rooms')).rooms).toHaveLength(0);
    q.send({ t: 'quick' });
    expect((await q.waitFor('room')).room.code).not.toBe(v.room.code);
  });

  it('private rooms stay out of the list', async () => {
    const host = await client('Host');
    host.send({ t: 'create', settings: { ...two(), public: false } });
    await host.waitFor('room');
    const q = await client('Snoop');
    q.send({ t: 'list' });
    expect((await q.waitFor('rooms')).rooms).toHaveLength(0);
  });

  it('a game against CPUs plays to the end and offers a rematch', async () => {
    const host = await client('Host');
    host.send({ t: 'create', settings: { ...defaultRoomSettings(), seats: ['cpu', 'cpu', 'closed', 'closed'], public: false } });
    await host.waitFor('room');
    host.send({ t: 'start' });
    await host.waitFor('game');
    const ended = await host.waitFor('room', (m) => m.room.phase === 'ended', 20000);
    expect(ended.room.phase).toBe('ended');
    expect(host.hashMismatch).toBe(0);
    host.send({ t: 'start' });
    expect((await host.waitFor('room', (m) => m.room.phase === 'lobby')).room.seats[0]!.kind).toBe('cpu');
  }, 30000);

  it('pauses when nobody is connected and resumes on return', async () => {
    const c = new Client(srv.url);
    clients.push(c);
    await c.open();
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Solo' });
    const w = await c.waitFor('welcome');
    c.send({ t: 'create', settings: { ...defaultRoomSettings(), seats: ['cpu', 'cpu', 'closed', 'closed'], public: false } });
    await c.waitFor('room');
    c.send({ t: 'start' });
    await c.waitFor('game');
    c.close();
    await sleep(150);
    const before = srv.hub.stats();
    await sleep(300);
    expect(srv.hub.stats().playing).toBe(before.playing);
    const back = new Client(srv.url);
    clients.push(back);
    await back.open();
    back.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Solo', token: w.token });
    const g = await back.waitFor('game');
    const seqAtReturn = g.game.seq;
    const next = await back.waitFor('applied', () => true, 3000);
    expect(next.seq).toBe(seqAtReturn + 1);
  });
});

describe('http', () => {
  it('serves the client, blocks traversal, rejects foreign-origin sockets, reports health', async () => {
    const outer = mkdtempSync(join(tmpdir(), 'fungus-outer-'));
    writeFileSync(join(outer, 'secret.txt'), 'TOP-SECRET');
    const dir = join(outer, 'public');
    mkdirSync(dir);
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Fungus</title>');
    writeFileSync(join(dir, 'assets', 'app-abc.js'), 'console.log(1)');
    await boot({ staticDir: dir });
    const index = await fetch(`${srv.url}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect((await fetch(`${srv.url}/some/route`)).status).toBe(200); // SPA fallback
    const asset = await fetch(`${srv.url}/assets/app-abc.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${srv.url}/missing.js`)).status).toBe(404);
    for (const evilPath of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/..\\secret.txt']) {
      const r = await fetch(`${srv.url}${evilPath}`);
      expect(await r.text()).not.toContain('TOP-SECRET');
    }
    const health = (await (await fetch(`${srv.url}/healthz`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);

    const evil = new Client(srv.url, { Origin: 'https://evil.example' });
    clients.push(evil);
    await expect(evil.open()).rejects.toBeTruthy();
  });

  it('caps sockets per address', async () => {
    await boot({ maxPerIp: 2 });
    // Opened at the same moment: exactly two get in, whichever they are.
    const all = [new Client(srv.url), new Client(srv.url), new Client(srv.url)];
    clients.push(...all);
    const results = await Promise.allSettled(all.map((c) => c.open()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    // A slot frees up when someone leaves.
    all[results.findIndex((r) => r.status === 'fulfilled')]!.close();
    await new Promise((r) => setTimeout(r, 100));
    const d = new Client(srv.url);
    clients.push(d);
    await d.open();
  });
});
