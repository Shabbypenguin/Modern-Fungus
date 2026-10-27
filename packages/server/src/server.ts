import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, parseClientMessage } from '@fungus/protocol';
import type { ServerMessage } from '@fungus/protocol';
import { Hub } from './hub.js';
import type { HubOptions } from './hub.js';
import { securityHeaders, staticHandler } from './static.js';

export interface ServerOptions extends HubOptions {
  port?: number;
  host?: string;
  /** Folder with the built client (packages/client/dist). Omit to serve only /ws and /healthz. */
  staticDir?: string;
  /** Trust X-Forwarded-For / CF-Connecting-IP (set when behind Traefik/Cloudflare). */
  trustProxy?: boolean;
  /** Max simultaneous sockets per client address. */
  maxPerIp?: number;
}

export interface Running {
  url: string;
  port: number;
  hub: Hub;
  close(): Promise<void>;
}

const HEARTBEAT_MS = 25_000;

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Only accept sockets opened by pages from this same site (blocks cross-site socket hijacking). */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests, tools) send no Origin
  try {
    const o = new URL(origin);
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    return typeof host === 'string' && o.host === host.split(',')[0]!.trim();
  } catch {
    return false;
  }
}

export async function startServer(opts: ServerOptions = {}): Promise<Running> {
  const hub = new Hub(opts);
  const trustProxy = !!opts.trustProxy;
  const maxPerIp = opts.maxPerIp ?? 12;
  const perIp = new Map<string, number>();
  const serveStatic = opts.staticDir ? staticHandler(opts.staticDir) : null;

  const http: Server = createServer((req, res) => {
    securityHeaders(res);
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...hub.stats() }));
      return;
    }
    if (serveStatic) {
      serveStatic(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });

  http.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '/').split('?')[0];
    const ip = clientIp(req, trustProxy);
    if (path !== '/ws' || !sameOrigin(req) || (perIp.get(ip) ?? 0) >= maxPerIp) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // Reserve the slot now, so simultaneous upgrades can't slip past the cap.
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    let attached = false;
    socket.once('close', () => {
      if (!attached) release(ip);
    });
    wss.handleUpgrade(req, socket, head, (ws) => {
      attached = true;
      attach(ws, ip);
    });
  });

  function release(ip: string): void {
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n > 0) perIp.set(ip, n);
    else perIp.delete(ip);
  }

  function attach(ws: WebSocket, ip: string): void {
    let alive = true;
    const conn = {
      send: (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(4000, 'replaced'),
    };
    const handle = hub.connect(conn);
    ws.on('pong', () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseClientMessage(data.toString());
      if (!msg) return conn.send({ t: 'error', code: 'bad-message', text: 'That message didn’t make sense to the server.' });
      try {
        handle.message(msg);
      } catch (e) {
        (opts.log ?? (() => {}))(`handler error: ${(e as Error).stack ?? e}`);
        conn.send({ t: 'error', code: 'bad-message', text: 'Something went wrong on the server.' });
      }
    });
    ws.on('close', () => {
      clearInterval(beat);
      release(ip);
      handle.close();
    });
    ws.on('error', () => ws.terminate());
  }

  await new Promise<void>((resolve) => http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', resolve));
  const port = (http.address() as AddressInfo).port;
  return {
    url: `http://localhost:${port}`,
    port,
    hub,
    close: () =>
      new Promise<void>((resolve) => {
        hub.shutdown();
        for (const c of wss.clients) c.terminate();
        wss.close();
        http.close(() => resolve());
        http.closeAllConnections?.();
      }),
  };
}
