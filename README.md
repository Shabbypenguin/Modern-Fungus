# Fungus

A faithful, cross-platform remake of **Fungus 2.0** (©1992, 1994 Ryan Koopmans), a classic Mac OS game.
It's a browser PWA with CPU players and online play.

- `docs/RULES.md` holds the classic rules, reverse-engineered from the original 68K code.
- `packages/engine` is the pure, deterministic rules engine (TypeScript). The client, the CPUs, and the server all share it.

## Develop (Windows / any OS)
```
npm install
npm run dev      # play at http://localhost:5173 (also reachable from phones on your LAN)
npm test         # rules engine tests
npm run build    # production PWA in packages/client/dist
```

## Layout
- `packages/engine` holds the rules, the classic CPU, and the tests. It has no DOM and runs in the browser and on the server.
- `packages/client` is the browser PWA (Vite + Canvas 2D, no framework).
