import './style.css';
import { Application } from 'pixi.js';
import { Scene } from './scene.ts';
import { loadLuaMath, type ComplexMath } from './rgs/lua-math.ts';
import { loadJsMath } from './rgs/js-math.ts';
import { ChickenRound, RgsError, type Wallet } from './rgs/round.ts';
import { laneMultiplier } from './rgs/display.ts';
import chickenLua from './rgs/lua/chicken-road.lua?raw';
import jsonLua from './rgs/lua/json.lua?raw';
import paramsLua from './rgs/lua/params.lua?raw';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- randomness: crypto by default, ?seed=N for reproducible runs (tests, visual regression) ----
const seedParam = new URLSearchParams(location.search).get('seed');
function makeRng(): () => number {
  if (seedParam !== null) { let s = Number(seedParam) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
  return () => { const u = new Uint32Array(2); crypto.getRandomValues(u); return (u[0] * 2 ** 21 + (u[1] >>> 11)) / 2 ** 53; };
}

// ---- wallet (play money, per browser) ----
const KEY = 'playBalance:chicken-road', START = 10000;
const wallet: Wallet = {
  get() { try { const v = parseFloat(localStorage.getItem(KEY) ?? ''); return Number.isFinite(v) ? v : START; } catch { return START; } },
  set(n) { try { localStorage.setItem(KEY, String(n)); } catch { /* storage blocked: balance lasts for this visit */ } },
};

async function loadMath(rng: () => number): Promise<{ math: ComplexMath; src: string }> {
  const wasmUrl = new URL('glue.wasm', document.baseURI).href;
  try {
    const math = await Promise.race([
      loadLuaMath({ math: chickenLua, json: jsonLua, params: paramsLua }, rng, wasmUrl),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('lua start timeout')), 6000)),
    ]);
    return { math, src: 'open-rgs Lua (WASM)' };
  } catch (e) {
    console.warn('Lua VM unavailable, using JS port of the same math:', e);
    return { math: loadJsMath(rng), src: 'JS port of open-rgs math' };
  }
}

async function boot() {
  const stage = $('stage');
  const app = new Application();
  await app.init({ resizeTo: stage, background: 0x1d2a22, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
  stage.appendChild(app.canvas);
  // the panel below changes height between setup and play; keep the canvas matched to the stage box
  new ResizeObserver(() => app.resize()).observe(stage);
  const scene = new Scene(app);

  const { math, src } = await loadMath(makeRng());
  $('mathSrc').textContent = src;
  const round = new ChickenRound(math, wallet);

  let difficulty = 'medium';
  let busy = false;
  const status = $('status');
  const setStatus = (main: string, sub = '', tone: '' | 'win' | 'lose' = '') => {
    $('statusMain').textContent = main; $('statusSub').textContent = sub; status.className = `status ${tone}`.trim();
  };
  const renderBalance = () => {
    $('balance').textContent = money(wallet.get());
    const broke = wallet.get() < 10;
    $<HTMLButtonElement>('play').hidden = broke; $('reset').hidden = !broke;
  };
  const showRun = (on: boolean) => { $('setup').hidden = on; $('run').hidden = !on; };
  const parseBet = () => Math.max(0, parseFloat($<HTMLInputElement>('betInput').value.replace(/[^\d.]/g, '')) || 0);
  const setBet = (v: number) => { $<HTMLInputElement>('betInput').value = String(Math.round(v * 100) / 100); };

  const refreshRun = () => {
    const nextLane = round.lane + 1;
    const cash = $<HTMLButtonElement>('cash');
    cash.disabled = busy || round.lane < 1;
    $<HTMLButtonElement>('cross').disabled = busy;
    $('cashAmt').textContent = round.lane >= 1 ? money(round.bet * round.multiplier) : '';
    if (round.phase === 'open') {
      const next = nextLane <= round.lanes ? `Next ×${laneMultiplier(round.difficulty, nextLane).toFixed(2)}` : '';
      setStatus(round.lane === 0 ? 'Tap Cross to start' : `Lane ${round.lane} of ${round.lanes}  ·  ×${round.multiplier.toFixed(2)}`, next);
    }
  };

  const finish = async (kind: 'cash' | 'across' | 'bust') => {
    const r = round.settle();
    renderBalance();
    if (kind === 'bust') {
      setStatus('Squashed!', `Lost ${money(round.bet)}`, 'lose');
    } else {
      scene.celebrate(r.win, kind === 'across' ? 'ACROSS!' : `×${r.multiplier.toFixed(2)}`);
      setStatus(kind === 'across' ? 'Made it across!' : 'Cashed out', `Paid ${money(r.win)}  (×${r.multiplier.toFixed(2)})`, 'win');
    }
    showRun(false);
    scene.idle(false);
    busy = false;
  };

  $('difficulty').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-d]') as HTMLButtonElement | null;
    if (!b) return;
    difficulty = b.dataset.d!;
    document.querySelectorAll('#difficulty button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    scene.reset(difficulty === 'daredevil' ? 12 : difficulty === 'hard' ? 16 : 20, (n) => laneMultiplier(difficulty, n));
    scene.idle(true);
  });
  $('chips').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button[data-v]') as HTMLButtonElement | null; if (b) setBet(Number(b.dataset.v)); });
  $('betMinus').addEventListener('click', () => setBet(Math.max(10, parseBet() - (parseBet() > 100 ? 100 : 10))));
  $('betPlus').addEventListener('click', () => setBet(Math.min(10000, parseBet() + (parseBet() >= 100 ? 100 : 10))));
  $('reset').addEventListener('click', () => { wallet.set(START); renderBalance(); setStatus('Play money refilled'); });

  $('play').addEventListener('click', () => {
    try {
      round.open(parseBet(), difficulty);
    } catch (e) {
      setStatus(e instanceof RgsError ? e.message : 'Could not start the round', '', 'lose');
      return;
    }
    renderBalance();
    scene.reset(round.lanes, (n) => laneMultiplier(round.difficulty, n));
    scene.idle(true);
    showRun(true);
    busy = false;
    refreshRun();
  });

  $('cross').addEventListener('click', async () => {
    if (busy || round.phase !== 'open') return;
    busy = true; refreshRun(); scene.idle(false);
    const r = round.cross();
    if (r.safe) {
      await scene.hopSafe(r.lane);
      if (r.finished) return finish('across');
      busy = false; scene.idle(true); refreshRun();
    } else {
      await scene.hopBust(r.lane);
      await finish('bust');
    }
  });

  $('cash').addEventListener('click', async () => {
    if (busy || round.phase !== 'open' || round.lane < 1) return;
    busy = true; await finish('cash');
  });

  // a round abandoned by closing the tab folds at its current value (the repo's settle-at-current autoclose)
  addEventListener('pagehide', () => { round.autoclose(); });

  scene.reset(20, (n) => laneMultiplier(difficulty, n));
  scene.idle(true);
  renderBalance();
  (window as any).__chicken = { round, scene, math };
  document.documentElement.dataset.ready = '1';
}

boot().catch((e) => { console.error(e); $('statusMain').textContent = 'Failed to start: ' + (e?.message ?? e); });
