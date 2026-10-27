/**
 * The browser side of the online connection: one WebSocket to the same site,
 * automatic reconnect with backoff, and a saved token so a reload or a dropped
 * connection puts you straight back in your seat. The token is kept per tab
 * (sessionStorage), so two tabs are two players rather than fighting over one seat.
 */
import { PROTOCOL_VERSION } from '@fungus/protocol';
import type { ClientMessage, ServerMessage } from '@fungus/protocol';

type Handler = (m: ServerMessage) => void;

const TOKEN_KEY = 'fungus.net.token';
const NAME_KEY = 'fungus.net.name';

function read(key: string, store: 'local' | 'session' = 'local'): string | null {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string, store: 'local' | 'session' = 'local'): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* no storage: reconnect still works while the page stays open */
  }
}

export function savedName(): string {
  return read(NAME_KEY) ?? '';
}
export function saveName(name: string): void {
  write(NAME_KEY, name);
}

export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<(s: NetStatus) => void>();
  private queue: ClientMessage[] = [];
  private greeted = false;
  private retry = 0;
  private retryTimer = 0;
  private pingTimer = 0;
  private closedByUser = false;
  private memoryToken: string | null = read(TOKEN_KEY, 'session');
  status: NetStatus = 'connecting';
  id: string | null = null;
  roomAtWelcome: string | null = null;

  constructor(private name: string) {
    this.open();
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(h: (s: NetStatus) => void): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  send(m: ClientMessage): void {
    if (this.greeted && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }

  setName(name: string): void {
    this.name = name;
  }

  /** Disconnect for good (leaving online play). */
  close(): void {
    if (this.closedByUser && this.status === 'offline') return;
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.setStatus('offline');
  }

  private setStatus(s: NetStatus): void {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    this.greeted = false;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, token: this.memoryToken ?? undefined } satisfies ClientMessage));
    };
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.greeted = true;
        this.retry = 0;
        this.id = m.id;
        this.roomAtWelcome = m.room;
        this.memoryToken = m.token;
        write(TOKEN_KEY, m.token, 'session');
        this.setStatus('online');
        const pending = this.queue.splice(0);
        for (const q of pending) ws.send(JSON.stringify(q));
        clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20_000);
      }
      for (const h of this.handlers) h(m);
    };
    ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      // 4000: this session was picked up by a newer connection; don't fight it for the seat.
      if (ev.code === 4000) this.closedByUser = true;
      if (this.closedByUser) return this.setStatus('offline');
      this.setStatus('reconnecting');
      // 0.5s, 1s, 2s … capped at 10s, with a little jitter so a server restart isn't stampeded.
      const delay = Math.min(10_000, 500 * 2 ** this.retry++) * (0.8 + Math.random() * 0.4);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => ws.close();
  }
}
