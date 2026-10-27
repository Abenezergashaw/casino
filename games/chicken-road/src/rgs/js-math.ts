// Pure-TypeScript port of chicken-road.lua. Used only if the Lua/WASM VM cannot start in the host
// (for example a strict CSP). test/math.test.ts proves it matches the Lua draw for draw.
import type { ComplexMath } from './lua-math.ts';

const RTP = 0.99;
const DIFFICULTY: Record<string, { p: number; lanes: number }> = {
  easy: { p: 0.95, lanes: 20 },
  medium: { p: 0.9, lanes: 20 },
  hard: { p: 0.8, lanes: 16 },
  daredevil: { p: 0.6, lanes: 12 },
};

export function loadJsMath(rng: () => number): ComplexMath {
  const mult = (p: number, lane: number) => RTP / p ** lane;
  return {
    name: 'chicken-road',
    rtp: RTP,
    open(ctx) {
      const v = ctx?.params?.difficulty;
      const name = typeof v === 'string' && v in DIFFICULTY ? v : 'medium';
      const cfg = DIFFICULTY[name];
      const state = { lane: 0, p: cfg.p, max: cfg.lanes, difficulty: name, busted: false };
      return {
        state: JSON.stringify(state),
        ops: [{ kind: 'chicken-road', action: 'init', difficulty: name, lanes: cfg.lanes }],
        awaiting: { type: 'cross' },
      };
    },
    step(stateStr) {
      const s = JSON.parse(stateStr);
      if (s.busted || s.lane >= s.max) return { state: stateStr, ops: [] };
      if (rng() < s.p) {
        s.lane += 1;
        return {
          state: JSON.stringify(s),
          ops: [{ kind: 'chicken-road', action: 'cross', lane: s.lane, safe: true, multiplier: mult(s.p, s.lane) }],
          awaiting: s.lane < s.max ? { type: 'cross' } : undefined,
        };
      }
      s.busted = true;
      return { state: JSON.stringify(s), ops: [{ kind: 'chicken-road', action: 'cross', lane: s.lane + 1, safe: false }] };
    },
    isTerminal(stateStr) {
      const s = JSON.parse(stateStr);
      return s.busted || s.lane >= 1;
    },
    close(stateStr) {
      const s = JSON.parse(stateStr);
      if (s.busted) return { multiplier: 0, type: 'squashed', ops: [{ kind: 'chicken-road', action: 'settle', busted: true }] };
      const m = mult(s.p, s.lane);
      const across = s.lane >= s.max;
      return { multiplier: m, type: across ? 'across' : 'cashout', ops: [{ kind: 'chicken-road', action: 'settle', busted: false, lane: s.lane, multiplier: m }] };
    },
    autoclose(stateStr) {
      const s = JSON.parse(stateStr);
      if (s.busted) return { multiplier: 0, type: 'autoclose-squashed', ops: [] };
      return { multiplier: s.lane >= 1 ? mult(s.p, s.lane) : 0, type: 'autoclose', ops: [] };
    },
  };
}
