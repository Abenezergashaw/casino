// chicken-road: cross lane by lane, the multiplier rising, cash out before you get hit.
//
// TypeScript port of open-rgs-examples/games/chicken-road/maths/chicken-road.lua (MIT), written for the
// TypeScript math tier: a default-exported factory taking the host, so randomness can only come from
// host.rng_next(). It passes the repo's purity gate (see test/real-loader.ts) and is proven draw-for-draw
// equal to the original Lua (see test/math.test.ts).
//
// Each "cross" survives with probability p (set by difficulty). After n lanes the multiplier is
//
//     m_n = RTP / p^n
//
// built here by repeated division (m_0 = RTP, m_n = m_(n-1) / p). Division is correctly rounded, so the
// ladder is bit-identical on every engine, which a power function is not guaranteed to be. The house edge
// is the same at every cash-out point: expected value of cashing out after n lanes is exactly RTP.
//
// Round shape: open -> cross* -> close. Cash-out is a CLOSE, not a STEP. The math is currency-blind: it
// returns a dimensionless multiplier and never sees a bet.

import type { ComplexMath, MathHost, SpinContext } from "@open-rgs/contract";

export const RTP = 0.99;

export type Difficulty = "easy" | "medium" | "hard" | "daredevil";

/** Survival chance per lane, and how many lanes there are to the golden egg. */
export const DIFFICULTY: Readonly<Record<Difficulty, { readonly p: number; readonly lanes: number }>> = {
  easy: { p: 0.95, lanes: 20 },
  medium: { p: 0.9, lanes: 20 },
  hard: { p: 0.8, lanes: 16 },
  daredevil: { p: 0.6, lanes: 12 },
};

export const DEFAULT_DIFFICULTY: Difficulty = "medium";
const NAMES: readonly string[] = ["easy", "medium", "hard", "daredevil"];

/** Client params are untrusted: only a known difficulty name passes, anything else is the default. */
export function parseDifficulty(value: unknown): Difficulty {
  return typeof value === "string" && NAMES.includes(value) ? (value as Difficulty) : DEFAULT_DIFFICULTY;
}

/** Multiplier after crossing `lane` lanes. Exported so the screen prints exactly what the math pays. */
export function multiplierAfter(difficulty: Difficulty, lane: number): number {
  const p = DIFFICULTY[difficulty].p;
  let m = RTP;
  for (let i = 0; i < lane; i++) m = m / p;
  return m;
}

interface RoundState {
  lane: number;
  p: number;
  max: number;
  difficulty: Difficulty;
  busted: boolean;
}

const encode = (s: RoundState): string => JSON.stringify(s);
const decode = (state: string): RoundState => JSON.parse(state) as RoundState;

export default function createMath(host: MathHost): ComplexMath {
  return {
    kind: "complex",
    name: "chicken-road",
    version: "1.0.0",
    rtp: RTP,
    expected: {
      // the simulator crosses one lane then cashes out: it survives with probability p
      hitRate: { target: DIFFICULTY[DEFAULT_DIFFICULTY].p, tolerance: 0.01 },
    },

    open(_prev: unknown, ctx: SpinContext) {
      const difficulty = parseDifficulty(ctx?.params?.["difficulty"]);
      const cfg = DIFFICULTY[difficulty];
      const state: RoundState = { lane: 0, p: cfg.p, max: cfg.lanes, difficulty, busted: false };
      return {
        state: encode(state),
        ops: [{ kind: "chicken-road", action: "init", difficulty, lanes: cfg.lanes }],
        awaiting: { type: "cross", prompt: `Cross lane 1 of ${cfg.lanes}?` },
      };
    },

    step(stateStr: string) {
      const s = decode(stateStr);
      if (s.busted || s.lane >= s.max) return { state: stateStr, ops: [] };

      if (host.rng_next() < s.p) {
        s.lane = s.lane + 1;
        const multiplier = multiplierAfter(s.difficulty, s.lane);
        return {
          state: encode(s),
          ops: [{ kind: "chicken-road", action: "cross", lane: s.lane, safe: true, multiplier }],
          ...(s.lane < s.max
            ? { awaiting: { type: "cross", prompt: `Cash out for x${multiplier.toFixed(2)}, or cross lane ${s.lane + 1}` } }
            : {}),
        };
      }

      s.busted = true;
      return {
        state: encode(s),
        ops: [{ kind: "chicken-road", action: "cross", lane: s.lane + 1, safe: false }],
      };
    },

    // a round can be closed once it is busted, or once at least one lane is crossed
    isTerminal(stateStr: string) {
      const s = decode(stateStr);
      return s.busted || s.lane >= 1;
    },

    close(stateStr: string) {
      const s = decode(stateStr);
      if (s.busted) {
        return { multiplier: 0, type: "squashed", ops: [{ kind: "chicken-road", action: "settle", busted: true }] };
      }
      const multiplier = multiplierAfter(s.difficulty, s.lane);
      return {
        multiplier,
        type: s.lane >= s.max ? "across" : "cashout",
        ops: [{ kind: "chicken-road", action: "settle", busted: false, lane: s.lane, multiplier }],
      };
    },

    // External-trigger autoclose (wallet or admin), never a timer inside the engine: settle at the current value.
    autoclose(stateStr: string) {
      const s = decode(stateStr);
      if (s.busted) return { multiplier: 0, type: "autoclose-squashed", ops: [] };
      const multiplier = s.lane >= 1 ? multiplierAfter(s.difficulty, s.lane) : 0;
      return { multiplier, type: "autoclose", ops: [{ kind: "chicken-road", action: "autoclose", lane: s.lane, multiplier }] };
    },
  };
}
