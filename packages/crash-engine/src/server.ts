// Transport-agnostic crash round server. Drive it from an in-browser mock (play-money demo)
// or wrap it in Socket.IO/Express later. It never touches the DOM or Node APIs.
import { crashPoint, multiplierAt, HmacSha256Hex } from './fair';
import { sha256Hex } from './sha256';

export type Phase = 'betting' | 'flying' | 'crashed';

export interface Bet {
  id: number;
  user: string;
  amount: number;
  autoCashout?: number;
  cashedAt?: number;
  win?: number;
  mine: boolean;
}

export interface Wallet {
  get(): number;
  set(n: number): void;
}

export interface CrashServerOptions {
  hmac: HmacSha256Hex;
  wallet: Wallet;
  bettingMs?: number;
  crashedMs?: number;
  tickMs?: number;
  minStake?: number;
  maxStake?: number;
  bots?: number;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export type ServerEvent =
  | { type: 'message'; message: string; update?: number }
  | { type: 'INCOMING_BET'; username: string; betAmount: number; gameCrashId: number; gameId: number }
  | { type: 'INCOMING_CANCEL_BET'; username: string; betAmount: number; gameCrashId: number; gameId: number }
  | { type: 'INCOMING_CASH_OUT'; username: string; betAmount: number; gameCrashId: number; gameId: number; crashed_at: number; cashout: number };

const BOT_NAMES = ['d***1', 'k***9', 'l***3', 'a***7', 'm***2', 'z***5', 'r***8', 'n***4', 'j***6', 't***0', 'b***2', 's***7'];
const round2 = (n: number) => Math.round(n * 100) / 100;

export class CrashServer {
  phase: Phase = 'crashed';
  roundNo = 0;
  private opts: Required<Omit<CrashServerOptions, 'hmac' | 'wallet'>> & Pick<CrashServerOptions, 'hmac' | 'wallet'>;
  private listeners = new Set<(e: ServerEvent) => void>();
  private bets = new Map<number, Bet>();
  private nextBetId = 1;
  private serverSeed = '';
  private crashAt = 1;
  private startedAt = 0;
  private timers: unknown[] = [];
  private tickTimer: unknown = null;
  private running = false;
  private history: number[] = [];
  private topWins: { username: string; bet: string; win: string; cashout: string; roundId: number; date: string }[] = [];
  private botTargets = new Map<number, number>();

  constructor(o: CrashServerOptions) {
    this.opts = {
      bettingMs: 8000,
      crashedMs: 3500,
      tickMs: 100,
      minStake: 10,
      maxStake: 10000,
      bots: 12,
      now: () => Date.now(),
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...o,
    };
    for (let i = 0; i < 18; i++) this.history.push(this.drawCrash(`warm${i}`));
  }

  // ---- lifecycle -------------------------------------------------------
  start() {
    if (this.running) return;
    this.running = true;
    this.beginBetting();
  }
  stop() {
    this.running = false;
    this.timers.forEach((t) => this.opts.clearTimer(t));
    this.timers = [];
    if (this.tickTimer) this.opts.clearTimer(this.tickTimer);
    this.tickTimer = null;
  }
  subscribe(fn: (e: ServerEvent) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit(e: ServerEvent) { this.listeners.forEach((l) => l(e)); }
  private later(fn: () => void, ms: number) { this.timers.push(this.opts.setTimer(fn, ms)); }

  private drawCrash(clientSeed: string) {
    const seed = Array.from({ length: 4 }, () => Math.floor(this.opts.random() * 2 ** 32).toString(16)).join('');
    return crashPoint(this.opts.hmac, seed, clientSeed, 0);
  }

  private beginBetting() {
    if (!this.running) return;
    this.roundNo += 1;
    this.phase = 'betting';
    this.bets = new Map();
    this.botTargets = new Map();
    this.serverSeed = Array.from({ length: 4 }, () => Math.floor(this.opts.random() * 2 ** 32).toString(16).padStart(8, '0')).join('');
    this.crashAt = crashPoint(this.opts.hmac, this.serverSeed, 'casino', this.roundNo);
    this.emit({ type: 'message', message: 'GAME_ALLOW_BET' });
    this.scheduleBots();
    this.later(() => this.beginFlight(), this.opts.bettingMs);
  }

  private scheduleBots() {
    const r = this.opts.random;
    for (let i = 0; i < this.opts.bots; i++) {
      this.later(() => {
        if (this.phase !== 'betting') return;
        const amount = [100, 200, 300, 500, 1000, 2000][Math.floor(r() * 6)];
        const user = BOT_NAMES[(i + this.roundNo) % BOT_NAMES.length];
        const bet: Bet = { id: this.nextBetId++, user, amount, mine: false };
        this.bets.set(bet.id, bet);
        // bots aim for a multiplier following the crash distribution, so they win about as often as real players
        this.botTargets.set(bet.id, Math.max(1.1, round2(0.97 / (1 - r() * 0.97))));
        this.emit({ type: 'INCOMING_BET', username: user, betAmount: amount, gameCrashId: bet.id, gameId: bet.id });
      }, 300 + r() * (this.opts.bettingMs - 1500));
    }
  }

  private beginFlight() {
    if (!this.running) return;
    this.phase = 'flying';
    this.startedAt = this.opts.now();
    this.emit({ type: 'message', message: 'GAME_START' });
    this.tick();
  }

  private tick = () => {
    if (!this.running || this.phase !== 'flying') return;
    const m = multiplierAt(this.opts.now() - this.startedAt);
    if (m >= this.crashAt) return this.crash();
    this.emit({ type: 'message', message: 'PAYOUT_STATUS_UPDATE', update: m });
    this.botCashouts(m);
    this.tickTimer = this.opts.setTimer(this.tick, this.opts.tickMs);
  };

  private botCashouts(m: number) {
    this.bets.forEach((b) => {
      if (b.mine || b.cashedAt) return;
      const target = this.botTargets.get(b.id);
      if (target && m >= target) this.settle(b, target);
    });
  }

  private crash() {
    this.phase = 'crashed';
    this.emit({ type: 'message', message: 'PAYOUT_STATUS_UPDATE', update: this.crashAt });
    this.emit({ type: 'message', message: 'GAME_STOP' });
    this.history.unshift(this.crashAt);
    this.history.length = Math.min(this.history.length, 30);
    this.later(() => this.beginBetting(), this.opts.crashedMs);
  }

  // ---- player actions (what the REST/socket layer calls) -----------------
  config() {
    return {
      config: { chips: [100, 200, 300, 500, 1000, 5000] },
      minStake: this.opts.minStake,
      maxStake: this.opts.maxStake,
      user: { account: { balance: this.opts.wallet.get() } },
    };
  }

  fairness() { return { hash: sha256Hex(this.serverSeed || 'pending') }; }

  recent() { return this.history.slice(0, 20).map((p) => ({ max_payout: p })); }

  top() { return this.topWins.slice(0, 20); }

  placeBet(amount: number, autoCashout?: number) {
    if (this.phase !== 'betting') return { status: false, message: 'Betting is closed for this round.' };
    if (!(amount >= this.opts.minStake) || amount > this.opts.maxStake)
      return { status: false, message: `Bet must be between ${this.opts.minStake} and ${this.opts.maxStake}.` };
    const bal = this.opts.wallet.get();
    if (amount > bal) return { status: false, message: 'Not enough play-money balance.' };
    this.opts.wallet.set(round2(bal - amount));
    const bet: Bet = { id: this.nextBetId++, user: 'You', amount, autoCashout, mine: true };
    this.bets.set(bet.id, bet);
    this.emit({ type: 'INCOMING_BET', username: 'You', betAmount: amount, gameCrashId: bet.id, gameId: bet.id });
    return {
      status: true,
      game: { id: bet.id, pf_game: { hash: this.fairness().hash }, account: { balance: this.opts.wallet.get() } },
    };
  }

  cancelBet(id: number) {
    const b = this.bets.get(id);
    if (!b || !b.mine || this.phase !== 'betting') return { status: false, balance: this.opts.wallet.get(), message: 'Cannot cancel this bet.' };
    this.bets.delete(id);
    this.opts.wallet.set(round2(this.opts.wallet.get() + b.amount));
    this.emit({ type: 'INCOMING_CANCEL_BET', username: 'You', betAmount: b.amount, gameCrashId: id, gameId: id });
    return { status: true, balance: this.opts.wallet.get(), message: '' };
  }

  /** Socket event "cashout" / "auto-cashout". The server decides the multiplier, never the client. */
  cashOut(id: number, auto: boolean) {
    const b = this.bets.get(id);
    if (!b || !b.mine || b.cashedAt || this.phase !== 'flying') {
      this.emit({ type: 'message', message: `INVALID_CASHOUT ${id}` });
      return;
    }
    const live = multiplierAt(this.opts.now() - this.startedAt);
    if (live >= this.crashAt) {
      this.emit({ type: 'message', message: `INVALID_CASHOUT ${id}` });
      return;
    }
    const at = auto && b.autoCashout ? Math.min(live, b.autoCashout) : live;
    this.settle(b, at);
    this.emit({ type: 'message', message: `${auto ? 'AUTO_CASHOUT' : 'CASHOUT'} ${id}` });
  }

  /** REST "cash-out": reports the already-settled win so the client can update its balance. */
  claimWin(id: number) {
    const b = this.bets.get(id);
    return { win: b?.mine && b.win ? b.win : 0 };
  }

  private settle(b: Bet, multiplier: number) {
    b.cashedAt = multiplier;
    b.win = round2(b.amount * multiplier);
    if (b.mine) this.opts.wallet.set(round2(this.opts.wallet.get() + b.win));
    this.topWins.unshift({
      username: b.user, bet: String(b.amount), win: String(b.win), cashout: multiplier.toFixed(2),
      roundId: this.roundNo, date: new Date(this.opts.now()).toISOString(),
    });
    this.topWins.sort((a, c) => parseFloat(c.win) - parseFloat(a.win));
    this.topWins.length = Math.min(this.topWins.length, 20);
    this.emit({
      type: 'INCOMING_CASH_OUT', username: b.user, betAmount: b.amount,
      gameCrashId: b.id, gameId: b.id, crashed_at: round2(multiplier), cashout: b.win,
    });
  }
}
