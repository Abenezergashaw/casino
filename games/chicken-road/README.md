# Chicken Road (play money)

Cross the road lane by lane; every safe hop raises the multiplier; cash out before a manhole bursts into flames.
Mobile-first PixiJS 8 + GSAP client over **open-rgs TypeScript math**.

## Layout

| Path | What |
|---|---|
| `maths/chicken-road.ts` | The game math. TypeScript port of `open-rgs-examples/games/chicken-road/maths/chicken-road.lua` (MIT), written for open-rgs' TypeScript math tier: a factory taking `host`, no ambient randomness, multiplier ladder built by repeated division. |
| `src/rgs/round.ts` | The rules open-rgs enforces around any math: integer minor units (ADR-002), stake at open, awaited action only, close only when terminal, fail-closed multiplier checks, engine-side max-win cap, settle-at-current autoclose. |
| `src/scene.ts`, `src/main.ts`, `index.html`, `src/style.css` | Presentation. The scene never decides an outcome. |
| `test/math.test.ts` | TypeScript == original Lua draw for draw; constant-EV on every difficulty; money rules. `npm test` (Bun) |
| `test/real-loader.ts` | Runs the port through the upstream repo's real `loadTsMath` and purity gate, and checks the gate rejects `Math.random`, the clock and `Math.pow`. `npm run test:loader` (Bun) |
| `e2e/smoke.cjs` | Real-browser test at phone and desktop size (needs a build). |
| `../../vendor/open-rgs-core/` | Unmodified files from open-rgs/open-rgs (MIT): contract types, TS loader + purity gate, money helper. |
| `../../vendor/open-rgs-examples/` | Unmodified open-rgs-examples (MIT): source of the Lua the port is proven against. |

## Differences from a real open-rgs deployment

- The math runs in the browser with a local wallet; there is no server, wallet adapter or wire transport here.
- Bets are typed amounts (integer cents). open-rgs takes bets from a server-provided ladder by index.
- The published `@open-rgs/core` 1.7.0 has no TypeScript loader; it exists only in the repo's main branch, so the loader files are vendored.
- With published core 1.7.0 and its Lua loader, a `difficulty` param sent as a plain object is ignored (the Lua reads it as a userdata proxy and falls back to medium). The TypeScript tier does not have this issue.

## Design reference

Visual design mocks the original Chicken Road's public screenshots (flat side-on view, manhole coins, fire hazard). All artwork here is drawn in code; no image files from the original are used.
