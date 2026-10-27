/**
 * Fungus server entry point.
 *   PORT         listen port (default 8787)
 *   STATIC_DIR   built client to serve (default ./public next to the bundle, if present)
 *   TRUST_PROXY  "1" when behind Traefik/Cloudflare, so per-IP limits see real client IPs
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultStatic = join(here, 'public');
const staticDir = process.env.STATIC_DIR ?? (existsSync(defaultStatic) ? defaultStatic : undefined);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const running = await startServer({
  port: Number(process.env.PORT ?? 8787),
  staticDir,
  trustProxy: process.env.TRUST_PROXY === '1',
  log,
});
log(`fungus server listening on :${running.port}${staticDir ? ` serving ${staticDir}` : ' (no static files)'}`);

const stop = async (sig: string) => {
  log(`${sig} received, shutting down`);
  await running.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
