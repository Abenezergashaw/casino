# Vendored from open-rgs/open-rgs (MIT)

Unmodified copies of the pieces of https://github.com/open-rgs/open-rgs used by our games:

- `contract/` : `packages/contract/src` (current main; adds `MathHost` / `MathFactory`, absent from the published 1.2.0)
- `core/ts-math.ts` : the TypeScript math loader and purity gate (not in the published `@open-rgs/core` 1.7.0)
- `core/rng.ts`, `core/log.ts` : helpers the loader imports
- `core/money.ts` : `settleAmount` (round half to even, ADR-002)

`SOURCE_COMMIT` is the upstream commit these files were copied from. Do not edit them here; re-copy instead.
`tsconfig.json` only maps `@open-rgs/contract` to the local copy.
