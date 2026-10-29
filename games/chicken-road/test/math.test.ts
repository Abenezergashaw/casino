// Run: npm test   (Bun, like the upstream repo)
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import type { ComplexMath } from '@open-rgs/contract';
import createMath, { DIFFICULTY, multiplierAfter, parseDifficulty, type Difficulty } from '../maths/chicken-road.ts';
import { loadLuaMath } from './lua-reference.ts';
import { ChickenRound } from '../src/rgs/round.ts';
import { laneMultiplier, collisionChance, lanesFor } from '../src/rgs/display.ts';

const lua = (f: string) => readFileSync(new URL(`./lua/${f}`, import.meta.url), 'utf8');
const sources = { math: lua('chicken-road.lua'), json: lua('json.lua'), params: lua('params.lua') };
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ts = (rng: () => number): ComplexMath => createMath({ rng_next: rng, log_debug: () => {} });
const names = Object.keys(DIFFICULTY) as Difficulty[];

// 1. The port reports what the original declared
const m0 = ts(lcg(1));
assert.equal(m0.kind, 'complex'); assert.equal(m0.name, 'chicken-road'); assert.equal(m0.rtp, 0.99);
assert.deepEqual(names.map((d) => [DIFFICULTY[d].p, DIFFICULTY[d].lanes]), [[0.95, 20], [0.9, 20], [0.8, 16], [0.6, 12]]);

// 2. TypeScript == the original Lua, draw for draw, on every difficulty (same RNG stream into both)
for (const d of names) {
  const a = lcg(42), b = lcg(42);
  const L = await loadLuaMath(sources, () => a());
  const T = ts(() => b());
  for (let r = 0; r < 300; r++) {
    const lo = L.open({ params: { difficulty: d } });
    const to = await T.open(undefined, { mode: 'default', params: { difficulty: d } });
    assert.deepEqual(JSON.parse(lo.state), JSON.parse(to.state));
    let ls = lo.state, tstate = to.state;
    const steps = 1 + (r % 7);
    for (let i = 0; i < steps; i++) {
      const lr = L.step(ls, { type: 'cross' });
      const tr = await T.step(tstate, { type: 'cross' });
      assert.deepEqual(JSON.parse(lr.state), JSON.parse(tr.state));
      assert.equal(lr.ops[0]?.safe, (tr.ops[0] as any)?.safe);
      if (lr.ops[0]?.safe) assert.ok(Math.abs(Number(lr.ops[0].multiplier) - Number((tr.ops[0] as any).multiplier)) < 1e-9);
      assert.equal(Boolean(lr.awaiting), Boolean(tr.awaiting));
      ls = lr.state; tstate = tr.state;
      if (!lr.awaiting) break;
    }
    assert.equal(L.isTerminal(ls), await T.isTerminal(tstate));
    if (L.isTerminal(ls)) {
      const lc = L.close(ls), tc = await T.close(tstate);
      assert.ok(Math.abs(lc.multiplier - tc.multiplier) < 1e-9 && lc.type === tc.type);
      const la = L.autoclose(ls), ta = await T.autoclose!(tstate);
      assert.ok(Math.abs(la.multiplier - ta.multiplier) < 1e-9 && la.type === ta.type);
    }
  }
}

// 2b. Hostile client params fall back to the default instead of reaching the math
for (const bad of [undefined, null, 5, {}, [], '__proto__', 'constructor', 'EASY', 'toString']) {
  assert.equal(parseDifficulty(bad), 'medium');
  const o = await ts(lcg(1)).open(undefined, { mode: 'default', params: { difficulty: bad as any } });
  assert.equal(JSON.parse(o.state).difficulty, 'medium');
}

// 3. Constant EV: cashing out after k lanes pays RTP on average, every difficulty
for (const d of names) for (const k of [1, 3, 6]) {
  const p = DIFFICULTY[d].p, rng = lcg(7 + k), T = ts(rng), N = 40000;
  let paid = 0;
  for (let n = 0; n < N; n++) {
    let s = (await T.open(undefined, { mode: 'default', params: { difficulty: d } })).state;
    for (let i = 0; i < k; i++) { const r = await T.step(s, { type: 'cross' }); s = r.state; if (JSON.parse(s).busted) break; }
    paid += (await T.close(s)).multiplier;
  }
  const tol = 0.99 * 4 * Math.sqrt((1 - p ** k) / (p ** k * N)) + 0.005;
  assert.ok(Math.abs(paid / N - 0.99) < tol, `${d} k=${k} rtp=${(paid / N).toFixed(4)} tol=${tol.toFixed(4)}`);
}

// 3b. The ladder: repeated division matches the closed form, and the screen reads the same function
for (const d of names) {
  for (let lane = 1; lane <= DIFFICULTY[d].lanes; lane++) {
    assert.ok(Math.abs(multiplierAfter(d, lane) - 0.99 / DIFFICULTY[d].p ** lane) < 1e-9 * multiplierAfter(d, lane));
    assert.equal(laneMultiplier(d, lane), multiplierAfter(d, lane));
  }
  assert.equal(lanesFor(d), DIFFICULTY[d].lanes);
  assert.ok(Math.abs(collisionChance(d) - (1 - DIFFICULTY[d].p)) < 1e-12);
}
console.log('math ok: ts==lua, constant-EV, ladder');

// 4. Round rules in integer minor units
const LIM = { min: 1, max: 100_000, maxWinMultiplier: 1_000_000 };
const mkWallet = (v: number) => ({ v, get() { return this.v; }, set(n: number) { this.v = n; } });
const w = mkWallet(100_000);
const R = new ChickenRound(ts(lcg(5)), w, LIM);
assert.throws(() => R.cross(), /No round/);
assert.throws(() => R.open(0, 'easy'), /outside/);
assert.throws(() => R.open(1.5, 'easy'), /outside/);                 // not an integer amount of cents
assert.throws(() => R.open(100_001, 'easy'), /outside/);
assert.throws(() => R.open(100_000_000, 'easy'), /outside/);
R.open(10_000, 'easy');
assert.equal(w.v, 90_000);                                            // stake leaves at open
assert.throws(() => R.open(100, 'easy'), /current round/);
assert.throws(() => R.settle(), /Cross at least one lane/);          // no cash-out before crossing
let guard = 0;
while (R.phase === 'open' && guard++ < 3) R.cross();
const quote = R.potentialWin();
const done = R.settle();
assert.ok(Number.isInteger(done.win) && Number.isInteger(w.v));
assert.equal(w.v, 90_000 + done.win);
if (done.win > 0) assert.equal(done.win, quote);                      // the button promised exactly what was paid
assert.throws(() => R.settle(), /No round/);                          // no double settle

// rounding is half to even on the settle boundary: 0.99/0.9 = 1.1 x 25 cents = 27.5 -> 28 (28 is even); x 5 = 5.5 -> 6
const fixed = (mult: number): ComplexMath => ({ ...ts(lcg(1)), close: () => ({ multiplier: mult, ops: [], type: 'cashout' }), isTerminal: () => true } as ComplexMath);
for (const [bet, mult, expect] of [[25, 1.1, 28], [5, 1.1, 6], [10, 0.25, 2], [10, 0.35, 4], [10, 0.45, 4]] as const) {
  const ww = mkWallet(1000), r = new ChickenRound(fixed(mult), ww, LIM);
  r.open(bet, 'easy'); const res = r.settle();
  assert.equal(res.win, expect, `bet ${bet} x ${mult}`);
}
// fail closed: NaN / Infinity never pay; negative clamps to 0; the engine caps the win
for (const bad of [NaN, Infinity, -Infinity]) {
  const ww = mkWallet(1000), r = new ChickenRound(fixed(bad), ww, LIM);
  r.open(100, 'easy');
  assert.throws(() => r.settle(), /non-finite/);
  assert.equal(ww.v, 900);                                            // nothing was paid
}
{ const ww = mkWallet(1000), r = new ChickenRound(fixed(-5), ww, LIM); r.open(100, 'easy'); assert.equal(r.settle().win, 0); }
{ const ww = mkWallet(1000), r = new ChickenRound(fixed(5000), ww, { ...LIM, maxWinMultiplier: 100 }); r.open(100, 'easy'); const x = r.settle(); assert.equal(x.win, 10_000); assert.equal(x.type, 'max_win_reached'); }
// abandoned round settles at its current value (settle-at-current autoclose)
{ const ww = mkWallet(100_000), r = new ChickenRound(ts(() => 0), ww, LIM); r.open(10_000, 'medium'); r.cross(); r.cross(); const a = r.autoclose()!; assert.equal(ww.v, 90_000 + a.win); assert.equal(a.win, Math.round(10_000 * multiplierAfter('medium', 2))); }
// the books balance over many random rounds on every difficulty
for (const d of names) {
  const ww = mkWallet(10_000_000), rr = lcg(99), r = new ChickenRound(ts(rr), ww, LIM);
  let net = 0;
  for (let i = 0; i < 400; i++) {
    const bet = 1 + Math.floor(rr() * 5000), before = ww.v;
    r.open(bet, d);
    const stop = 1 + Math.floor(rr() * 5);
    for (let c = 0; c < stop && r.phase === 'open'; c++) r.cross();
    const res = r.settle();
    assert.equal(ww.v, before - bet + res.win); net += res.win - bet;
  }
  assert.ok(Number.isInteger(ww.v));
}
console.log('round rules ok (integer money, half-even, fail-closed, cap, autoclose)');
