// One chicken-road round against an open-rgs math module, with the same rules the open-rgs orchestrator
// enforces: stake leaves the wallet at open, only the awaited action is accepted, close only when the
// math says the round is terminal, and a hard cap on the win multiplier.
import type { ComplexMath, Op } from './lua-math.ts';

export interface Wallet { get(): number; set(n: number): void }
export type Phase = 'idle' | 'open' | 'busted' | 'settled';

export class RgsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface CrossResult { safe: boolean; lane: number; multiplier: number; finished: boolean; ops: Op[] }
export interface SettleResult { win: number; multiplier: number; type: string }

const round2 = (n: number) => Math.round(n * 100) / 100;

export class ChickenRound {
  phase: Phase = 'idle';
  bet = 0;
  lane = 0;
  multiplier = 1;
  difficulty = 'medium';
  lanes = 20;
  private state = '';
  private awaitingCross = false;

  constructor(
    private math: ComplexMath,
    private wallet: Wallet,
    private limits = { min: 10, max: 10000, maxWinMultiplier: 1_000_000 },
  ) {}

  open(bet: number, difficulty: string) {
    if (this.phase === 'open') throw new RgsError('ROUND_IN_PROGRESS', 'Finish the current round first.');
    if (!Number.isFinite(bet) || bet < this.limits.min || bet > this.limits.max)
      throw new RgsError('INVALID_BET', `Bet must be between ${this.limits.min} and ${this.limits.max}.`);
    const bal = this.wallet.get();
    if (bet > bal) throw new RgsError('INSUFFICIENT_FUNDS', 'Not enough play money.');
    this.wallet.set(round2(bal - bet));
    const o = this.math.open({ params: { difficulty } });
    this.state = o.state;
    this.bet = bet;
    this.lane = 0;
    this.multiplier = 1;
    this.awaitingCross = o.awaiting?.type === 'cross';
    const init = o.ops.find((x) => x.action === 'init');
    this.difficulty = String(init?.difficulty ?? difficulty);
    this.lanes = Number(init?.lanes ?? 20);
    this.phase = 'open';
  }

  cross(): CrossResult {
    if (this.phase !== 'open') throw new RgsError('NO_ROUND', 'No round in progress.');
    if (!this.awaitingCross) throw new RgsError('INVALID_ACTION', 'The chicken is already across.');
    const s = this.math.step(this.state, { type: 'cross' });
    this.state = s.state;
    this.awaitingCross = s.awaiting?.type === 'cross';
    const op = s.ops.find((x) => x.action === 'cross');
    const safe = Boolean(op?.safe);
    if (safe) {
      this.lane = Number(op!.lane);
      this.multiplier = Number(op!.multiplier);
    } else {
      this.phase = 'busted';
    }
    return {
      safe,
      lane: Number(op?.lane ?? this.lane),
      multiplier: safe ? this.multiplier : 0,
      finished: safe && !this.awaitingCross,
      ops: s.ops,
    };
  }

  /** Cash out (or settle a bust, which pays 0). */
  settle(): SettleResult {
    if (this.phase !== 'open' && this.phase !== 'busted') throw new RgsError('NO_ROUND', 'No round to settle.');
    if (!this.math.isTerminal(this.state)) throw new RgsError('NOT_TERMINAL', 'Cross at least one lane before cashing out.');
    const c = this.math.close(this.state);
    const capped = Math.min(c.multiplier, this.limits.maxWinMultiplier);
    const win = round2(this.bet * capped);
    if (win > 0) this.wallet.set(round2(this.wallet.get() + win));
    this.phase = 'settled';
    return { win, multiplier: capped, type: c.type };
  }

  /** Fold a round that is still open (page closed mid-run) at its current value. */
  autoclose(): SettleResult | null {
    if (this.phase !== 'open') return null;
    const c = this.math.autoclose(this.state);
    const win = round2(this.bet * Math.min(c.multiplier, this.limits.maxWinMultiplier));
    if (win > 0) this.wallet.set(round2(this.wallet.get() + win));
    this.phase = 'settled';
    return { win, multiplier: c.multiplier, type: c.type };
  }
}
