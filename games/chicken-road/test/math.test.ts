// Run: npm test   (node --experimental-strip-types)
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { loadLuaMath } from '../src/rgs/lua-math.ts';
import { loadJsMath } from '../src/rgs/js-math.ts';
import { ChickenRound } from '../src/rgs/round.ts';
import { laneMultiplier } from '../src/rgs/display.ts';

const lua = (f: string) => readFileSync(new URL(`../src/rgs/lua/${f}`, import.meta.url), 'utf8');
const sources = { math: lua('chicken-road.lua'), json: lua('json.lua'), params: lua('params.lua') };

// small deterministic PRNG so two implementations can see the same draws
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const diffs = { easy: 0.95, medium: 0.9, hard: 0.8, daredevil: 0.6 } as const;

// 1. The Lua runs and reports what the repo's game.json says
let draws = lcg(1);
const math = await loadLuaMath(sources, () => draws());
assert.equal(math.name, 'chicken-road');
assert.equal(math.rtp, 0.99);

// 2. Lua and the JS port agree draw for draw, across every difficulty and 300 rounds each
for (const d of Object.keys(diffs)) {
  const a = lcg(42), b = lcg(42);
  const L = await loadLuaMath(sources, () => a());
  const J = loadJsMath(() => b());
  for (let r = 0; r < 300; r++) {
    let lo = L.open({ params: { difficulty: d } }), jo = J.open({ params: { difficulty: d } });
    assert.deepEqual(JSON.parse(lo.state), JSON.parse(jo.state));
    let ls = lo.state, js = jo.state, steps = 1 + (r % 7);
    for (let i = 0; i < steps; i++) {
      const lr = L.step(ls, { type: 'cross' }), jr = J.step(js, { type: 'cross' });
      assert.deepEqual(JSON.parse(lr.state), JSON.parse(jr.state));
      assert.equal(lr.ops[0]?.safe, jr.ops[0]?.safe);
      ls = lr.state; js = jr.state;
      if (!lr.awaiting) break;
    }
    if (L.isTerminal(ls)) {
      const lc = L.close(ls), jc = J.close(js);
      assert.ok(Math.abs(lc.multiplier - jc.multiplier) < 1e-9 && lc.type === jc.type);
    }
  }
}

// 3. Constant-EV: cash out after k lanes pays RTP on average, on every difficulty
for (const [d, p] of Object.entries(diffs)) {
  for (const k of [1, 3, 6]) {
    const rng = lcg(7 + k);
    const L = await loadLuaMath(sources, () => rng());
    const N = 40000;
    let paid = 0;
    for (let n = 0; n < N; n++) {
      let s = L.open({ params: { difficulty: d } }).state;
      for (let i = 0; i < k; i++) { const r = L.step(s, { type: 'cross' }); s = r.state; if (!r.awaiting && r.ops[0]?.safe === false) break; }
      paid += L.close(s).multiplier;
    }
    const rtp = paid / N;
    // survive-k probability is p^k, so tolerance widens as p^k shrinks
    const tol = 0.99 * 4 * Math.sqrt((1 - p ** k) / (p ** k * N)) + 0.005;
    assert.ok(Math.abs(rtp - 0.99) < tol, `${d} k=${k} rtp=${rtp.toFixed(4)} tol=${tol.toFixed(4)}`);
  }
}
console.log('math ok: lua==js, constant-EV across difficulties');

// 3b. the lane tags the UI prints equal the multipliers the Lua really pays
for (const d of Object.keys(diffs)) {
  const L = await loadLuaMath(sources, () => 0);   // rng 0 => every lane is survived
  let s = L.open({ params: { difficulty: d } }).state, lane = 0;
  for (let r = L.step(s, { type: 'cross' }); r.ops[0]?.safe; r = L.step(r.state, { type: 'cross' })) {
    lane = Number(r.ops[0].lane);
    assert.ok(Math.abs(Number(r.ops[0].multiplier) - laneMultiplier(d, lane)) < 1e-9, `${d} lane ${lane}`);
    if (!r.awaiting) break;
  }
  assert.equal(lane, d === 'daredevil' ? 12 : d === 'hard' ? 16 : 20);
}

// 4. Round/wallet rules
const wallet = { v: 1000, get() { return this.v; }, set(n: number) { this.v = n; } };
draws = lcg(5);
const R = new ChickenRound(math, wallet);
assert.throws(() => R.cross(), /No round/);
assert.throws(() => R.open(5, 'easy'), /Bet must be/);
assert.throws(() => R.open(5000, 'easy'), /Not enough/);
R.open(100, 'easy');
assert.equal(wallet.v, 900);
assert.throws(() => R.open(100, 'easy'), /current round/);
assert.throws(() => R.settle(), /Cross at least one lane/);        // cannot cash out before crossing
let guard = 0, last = null as any;
while (R.phase === 'open' && guard++ < 3) last = R.cross();
const done = R.settle();
assert.equal(wallet.v, Math.round((900 + done.win) * 100) / 100);
assert.ok(done.win === 0 ? R.phase === 'settled' && last.safe === false : done.win > 100 * 0.99);
assert.throws(() => R.settle(), /No round/);                        // cannot settle twice
// unknown/hostile difficulty falls back to medium (params.lua)
const odd = new ChickenRound(math, { get: () => 1000, set() {} });
odd.open(10, '__proto__'); assert.equal(odd.difficulty, 'medium');
console.log('round rules ok');
