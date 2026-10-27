# Fungus

A faithful, cross-platform remake of **Fungus 2.0** (©1992, 1994 Ryan Koopmans), a classic Mac OS game.
It's a browser PWA with CPU players and online play.

**Play:** https://fungus.shabbygames.club · **Guide:** the [wiki](https://github.com/Shabbypenguin/Modern-Fungus/wiki) covers how to play, controls, rules, Modern mode, settings, online play and development.

- `docs/RULES.md` holds the classic rules, reverse-engineered from the original 68K code, plus Modern mode and board sizes.
- **Classic** is the 1994 game, for up to 4 players. **Modern** seats up to 16 in a fair ring, on boards from 20×20 to 100×100.
- `packages/engine` is the pure, deterministic rules engine (TypeScript). The client, the CPUs, and the server all share it.

## Develop (Windows / any OS)
```
npm install
npm run dev      # game server on :8787 + client at http://localhost:5173 (LAN phones too)
npm test         # engine, protocol and server tests
npm run build    # client to packages/client/dist, server to packages/server/dist/server.mjs
npm start        # run the built server (serve the client with STATIC_DIR=packages/client/dist)
```

## Online play
The server is authoritative. Clients send moves, the server checks them and broadcasts every accepted action.
Each client replays the action with the shared engine and compares a state hash; on any mismatch it asks for a fresh snapshot.
- Nickname only, no accounts. A per-tab token puts a reloaded or dropped player back in their seat.
- Room codes and invite links (`?room=CODE`), a public room browser, and Quick play.
- A player who drops out gets 60 seconds to return, then a CPU plays for them until they come back. Leaving hands the fungus to a CPU for good.
- Quick emotes only, no chat.
- Limits: 16 KB messages, per-session rate limit, 12 sockets per IP, 200 rooms, 2000 sessions, same-origin WebSocket check, strict CSP.

## Self-hosting
The `Dockerfile` runs the tests, builds, and produces a small non-root `node:22-alpine` image with a `/healthz` healthcheck:
```
docker build -t fungus . && docker run -p 8787:8787 fungus
```
Behind a reverse proxy, forward `/ws` as a WebSocket and set `TRUST_PROXY=1`. See the wiki's Development page for every setting.

## Layout
- `packages/engine` holds the rules, the classic CPU, and the tests. It has no DOM and runs in the browser and on the server.
- `packages/client` is the browser PWA (Vite + Canvas 2D, no framework).
- `packages/protocol` holds the message types and validation shared by the client and server.
- `packages/server` is the Node game server (`ws`), which also serves the built client.

## Wiki
The wiki's source is `docs/wiki`. `.github/workflows/wiki.yml` publishes it on every push to `main`, so edit pages there rather than on GitHub.
