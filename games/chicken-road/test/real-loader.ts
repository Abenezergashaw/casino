// Run: npm run test:loader  (Bun). Loads the port through the upstream repo's REAL TypeScript loader.
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTsMath, assertPure, collectMathSources } from '../../../vendor/open-rgs-core/core/ts-math.ts';
import createMath from '../maths/chicken-road.ts';

const entry = new URL('../maths/chicken-road.ts', import.meta.url).pathname;
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// 1. The purity gate accepts the port, over every local file it is built from
const files = await collectMathSources(entry);
for (const f of files) assertPure(f.src, f.path);
console.log('purity gate: passed for', files.map((f) => f.path.split('/').pop()).join(', '));

// 2. The real loader returns a stamped complex math whose outcomes equal a direct instantiation on the same stream
const a = lcg(11), b = lcg(11);
const loaded: any = await loadTsMath(entry, { rng: () => a() });
const direct: any = createMath({ rng_next: () => b(), log_debug: () => {} });
assert.equal(loaded.kind, 'complex');
assert.match(loaded.contentHash, /^[0-9a-f]{64}$/);
for (let r = 0; r < 200; r++) {
  const d = ['easy', 'medium', 'hard', 'daredevil'][r % 4];
  let ls = (await loaded.open(undefined, { mode: 'default', params: { difficulty: d } })).state;
  let ds = (await direct.open(undefined, { mode: 'default', params: { difficulty: d } })).state;
  for (let i = 0; i < 4; i++) { ls = (await loaded.step(ls, { type: 'cross' })).state; ds = (await direct.step(ds, { type: 'cross' })).state; }
  assert.equal(ls, ds);
}
console.log('real loader: ok, contentHash', loaded.contentHash.slice(0, 16));

// 3. The gate is real: the same math with ambient randomness is rejected
const dir = mkdtempSync(join(tmpdir(), 'rgs-gate-'));
for (const [name, body] of [['random', 'Math.random()'], ['clock', 'Date.now()'], ['pow', 'Math.pow(2, 3)']] as const) {
  const f = join(dir, `${name}.ts`);
  writeFileSync(f, `export default (host: any) => ({ kind: 'simple', name: 'x', version: '1', rtp: 1, play: () => ({ multiplier: ${body}, ops: [], type: 't' }) });`);
  await assert.rejects(() => loadTsMath(f, { rng: () => 0.5 }), (e: unknown) => e instanceof Error, `${name} should be rejected`);
}
console.log('purity gate rejects Math.random, the clock and Math.pow');
