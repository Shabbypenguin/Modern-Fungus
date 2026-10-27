# Development

## Quick start
Needs Node 22+ and npm 10+.
```
git clone https://github.com/Shabbypenguin/Modern-Fungus.git
cd Modern-Fungus
npm install
npm run dev
```
`npm run dev` starts the **game server** on port 8787 and the **Vite client** at http://localhost:5173, with `/ws` proxied to the server. Phones on your network can open the "Network" address Vite prints.

| Command | Does |
|---|---|
| `npm run dev` | Server and client together, with reload on change (Ctrl+C stops both) |
| `npm run dev:client` / `npm run dev:server` | Just one of them |
| `npm test` | Engine, protocol and server tests (Vitest) |
| `npm run typecheck` | TypeScript across every package |
| `npm run build` | Client to `packages/client/dist`, server bundle to `packages/server/dist/server.mjs` |
| `npm start` | Run the built server |

## Layout
An npm-workspaces monorepo:

| Package | What it is |
|---|---|
| `packages/engine` | The rules. Pure, deterministic TypeScript with no DOM: game state, moves, capture, bites, teeth, Modern layouts, the Classic CPU, the stand-in CPU, and the state hash. |
| `packages/protocol` | Online message types, constants and validation, shared by client and server. |
| `packages/server` | Node game server (`ws`). It runs rooms and games, and also serves the built client. |
| `packages/client` | The browser PWA: Vite, Canvas 2D, no framework. |
| `docs/RULES.md` | The rules spec, with addresses in the original 68K code. |
| `docs/wiki` | These wiki pages. |

## The engine
- **State is plain JSON**: board cells, teeth, players, current turn, piece, round, RNG seed. It can be saved, sent over the network, or hashed.
- **`applyAction(state, player, action)`** returns a **new** state plus a list of events (placed, captured, died, bitten, tooth, killed, and so on), or an error. It never changes its input.
- **Deterministic:** all randomness (pieces, tooth timing, the bite roll) comes from a seeded RNG (mulberry32) stored in the state. The same state plus the same action always gives the same result.
- **Queries:** `checkPlacement`, `legalPlacements`, `checkBite`, `biteStarts`, `hasAnyMove`, `biteLevel`, `cellCount`.
- **Configs:** `classicConfig(players, overrides)` and `modernConfig(players, size, overrides, { newTeeth, biteGrowth })`. Constants live in `config.ts`.

## Online architecture
The server is **authoritative**:
1. A client sends `act { seq, action }`. `seq` is how many actions it has seen.
2. The server checks that it's that player's turn, that `seq` is current, and that the move is legal. Then it applies the move.
3. It broadcasts `applied { seq, player, action, hash, timeLeft, standIns }` to the room.
4. Each client replays the action with the same engine and compares **`stateHash`** (FNV-1a over the state). If the hash differs or a message was missed, the client asks for a **`resync`** and gets a full snapshot.

Other details:
- **Sessions:** the server issues a random token at `hello`. The client keeps it per tab (sessionStorage), so a reload or reconnect returns to the same seat.
- **Timers and CPUs run on the server.** Clients only display them. A game pauses when nobody in its room is connected.
- **Message types** are in `packages/protocol/src/index.ts`:
  - **client → server:** hello, list, create, join, quick, leave, sit, seat, settings, start, act, resync, emote, ping
  - **server → client:** welcome, rooms, room, left, game, applied, timer, emote, notice, error, pong
- **Hardening:**
  - Messages: 16 KB maximum, with every message validated.
  - Rate limits: 40 messages burst, then 12 per second; emotes at most one every 1.5 s.
  - Connections: 12 sockets per address, same-origin check on the WebSocket upgrade.
  - Server-wide caps: 200 rooms, 2000 sessions.
  - Pages: strict Content-Security-Policy.

## The client
- `main.ts`: home screen. `game.ts`: the game screen, local or online. `online.ts`: online menu and screen flow. `lobby.ts`: room lobby. `net.ts`: WebSocket client with automatic reconnect.
- `render.ts`: canvas renderer.
  - A camera with zoom and pan, down to 4×4 cells.
  - Only visible cells are drawn, so 100×100 boards stay at 60 fps.
  - Patterns are anchored to the grid. Effects include captures, bites and death animations.
- `textures.ts`: the 16 player styles. `controls.ts`: the control map, used in the game and on [[Controls]].
- Sizes are in `rem` and scale with the viewport and **Interface size**.
- Development builds expose `window.__fungus` for automated browser tests. Production builds strip it.

## Tests
- **Engine:**
  - Every rule in `docs/RULES.md`.
  - The Classic CPU, Modern layout fairness for every player count and board, speeds, the bite roll, and the stand-in CPU.
- **Protocol:** name cleaning, codes, settings validation, message parsing.
- **Server:** real WebSocket integration tests. They cover full games with matching hashes, illegal and out-of-turn moves, timers, stand-ins, reconnect, quick play, private and abandoned rooms, rematch, pause, static files, CSP, origin checks and per-address limits.

## Self-hosting
The `Dockerfile` runs the tests, builds, and produces a small `node:22-alpine` image that runs as a non-root user and has a `/healthz` healthcheck.
```
docker build -t fungus:local .
docker run -p 8787:8787 fungus:local
```
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | Listen port |
| `STATIC_DIR` | `./public` beside the server | Built client to serve |
| `TRUST_PROXY` | off (`1` in the image) | Trust `CF-Connecting-IP` / `X-Forwarded-For` for per-address limits. Turn it on only behind a proxy. |

Behind a reverse proxy, forward `/ws` as a WebSocket; most proxies (Traefik, Caddy, Cloudflare) do that without extra configuration. Run only one container, because rooms live in memory.

## The wiki
Pages live in `docs/wiki` and are published to the GitHub wiki by `.github/workflows/wiki.yml` on every push to `main` that changes them. Edit them in the repository, not in the wiki, because the next sync overwrites wiki edits.
