// One chicken-road round against an open-rgs math module, enforcing the rules the open-rgs orchestrator enforces
// around any math: amounts are integers in minor units (ADR-002), the stake leaves the wallet at open, only the
// awaited action is accepted, close happens only when the math says the round is terminal, a non-finite
// multiplier fails the round instead of paying (guarantee 5), a negative one is clamped to 0, and every win is
// capped by the engine (guarantee 7), never by the math. The math itself never sees the bet (guarantee 3).
import type { ComplexMath, SpinContext } from '@open-rgs/contract';
import { settleAmount } from '../../../../vendor/open-rgs-core/core/money.ts';

/** Wallet in integer minor units (cents). */
export interface Wallet { get(): number; set(n: number): void }
export type Phase = 'idle' | 'open' | 'busted' | 'settled';

export class RgsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface Limits { min: number; max: number; maxWinMultiplier: number }
export interface CrossResult { safe: boolean; lane: number; multiplier: number; finished: boolean }
export interface SettleResult { win: number; multiplier: number; type: string }
type Op = Record<string, unknown>;

/** The game runs the math in-process, so every call resolves synchronously. */
function sync<T>(v: T | Promise<T>): T {
  if (v instanceof Promise) throw new RgsError('INTERNAL_ERROR', 'chicken-road math must be synchronous');
  return v;
}

export class ChickenRound {
  phase: Phase = 'idle';
  bet = 0;
  lane = 0;
  multiplier = 1;
  difficulty = 'medium';
  lanes = 20;
  private state = '';
  private awaitingCross = false;

  constructor(private math: ComplexMath, private wallet: Wallet, private limits: Limits) {}

  /** `bet` is an integer in minor units. */
  open(bet: number, difficulty: string) {
    if (this.phase === 'open') throw new RgsError('ROUND_IN_PROGRESS', 'Finish the current round first.');
    if (!Number.isSafeInteger(bet) || bet < this.limits.min || bet > this.limits.max)
      throw new RgsError('INVALID_BET', 'Bet is outside the allowed range.');
    const bal = this.wallet.get();
    if (bet > bal) throw new RgsError('INSUFFICIENT_FUNDS', 'Not enough play money.');
    const ctx: SpinContext = { mode: 'default', params: { difficulty } };
    const o = sync(this.math.open(undefined, ctx));
    this.wallet.set(bal - bet);
    this.state = o.state;
    this.bet = bet;
    this.lane = 0;
    this.multiplier = 1;
    this.awaitingCross = o.awaiting?.type === 'cross';
    const init = (o.ops as Op[]).find((x) => x['action'] === 'init');
    this.difficulty = String(init?.['difficulty'] ?? difficulty);
    this.lanes = Number(init?.['lanes'] ?? 20);
    this.phase = 'open';
  }

  cross(): CrossResult {
    if (this.phase !== 'open') throw new RgsError('NO_ROUND', 'No round in progress.');
    if (!this.awaitingCross) throw new RgsError('INVALID_ACTION', 'The chicken is already across.');
    const s = sync(this.math.step(this.state, { type: 'cross' }));
    this.state = s.state;
    this.awaitingCross = s.awaiting?.type === 'cross';
    const op = (s.ops as Op[]).find((x) => x['action'] === 'cross');
    const safe = Boolean(op?.['safe']);
    if (safe) {
      this.lane = Number(op!['lane']);
      this.multiplier = Number(op!['multiplier']);
    } else {
      this.phase = 'busted';
    }
    return { safe, lane: Number(op?.['lane'] ?? this.lane), multiplier: safe ? this.multiplier : 0, finished: safe && !this.awaitingCross };
  }

  /** What cashing out right now would pay, in minor units, rounded exactly as the payout will be. */
  potentialWin(): number {
    return this.lane >= 1 ? settleAmount(Math.min(this.multiplier, this.limits.maxWinMultiplier), this.bet) : 0;
  }

  /** Cash out (or settle a bust, which pays 0). */
  settle(): SettleResult {
    if (this.phase !== 'open' && this.phase !== 'busted') throw new RgsError('NO_ROUND', 'No round to settle.');
    if (!sync(this.math.isTerminal(this.state))) throw new RgsError('NOT_TERMINAL', 'Cross at least one lane before cashing out.');
    const c = sync(this.math.close(this.state));
    return this.pay(c.multiplier, c.type);
  }

  /** Fold a round that is still open (page closed mid-run) at its current value: the repo's settle-at-current policy. */
  autoclose(): SettleResult | null {
    if (this.phase !== 'open') return null;
    const c = sync(this.math.autoclose!(this.state));
    return this.pay(c.multiplier, c.type);
  }

  private pay(rawMultiplier: number, type: string): SettleResult {
    // fail closed: a non-finite multiplier is a math fault, never a payout
    if (!Number.isFinite(rawMultiplier)) throw new RgsError('INTERNAL_ERROR', 'Math returned a non-finite multiplier.');
    const multiplier = Math.min(Math.max(rawMultiplier, 0), this.limits.maxWinMultiplier);
    const win = settleAmount(multiplier, this.bet);
    if (win > 0) this.wallet.set(this.wallet.get() + win);
    this.phase = 'settled';
    return { win, multiplier, type: multiplier < rawMultiplier ? 'max_win_reached' : type };
  }
}
