import './style.css';
import { Application } from 'pixi.js';
import { Scene } from './scene.ts';
import { loadLuaMath, type ComplexMath } from './rgs/lua-math.ts';
import { loadJsMath } from './rgs/js-math.ts';
import { ChickenRound, RgsError, type Wallet } from './rgs/round.ts';
import { laneMultiplier, collisionChance, DIFFICULTY_LANES } from './rgs/display.ts';
import chickenLua from './rgs/lua/chicken-road.lua?raw';
import jsonLua from './rgs/lua/json.lua?raw';
import paramsLua from './rgs/lua/params.lua?raw';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// the reference game prints balances with thin-space groups and no decimals when whole
const money = (n: number) => {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const s = (whole ? Math.round(n).toString() : n.toFixed(2));
  const [i, d] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? '.' + d : '');
};
const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// the screen says Hardcore; the repo's math calls the same setting "daredevil"
const toMath = (d: string) => (d === 'hardcore' ? 'daredevil' : d);

// ---- randomness: crypto by default, ?seed=N for reproducible runs (tests, visual regression) ----
const seedParam = new URLSearchParams(location.search).get('seed');
function makeRng(): () => number {
  if (seedParam !== null) { let s = Number(seedParam) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
  return () => { const u = new Uint32Array(2); crypto.getRandomValues(u); return (u[0] * 2 ** 21 + (u[1] >>> 11)) / 2 ** 53; };
}

// ---- wallet (play money, per browser) ----
const KEY = 'playBalance:chicken-road', START = 1_000_000;
const wallet: Wallet = {
  get() { try { const v = parseFloat(localStorage.getItem(KEY) ?? ''); return Number.isFinite(v) ? v : START; } catch { return START; } },
  set(n) { try { localStorage.setItem(KEY, String(n)); } catch { /* storage blocked: balance lasts for this visit */ } },
};
const LIMITS = { min: 0.01, max: 1000, maxWinMultiplier: 1_000_000 };

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
  await app.init({ resizeTo: stage, background: 0x353c55, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
  stage.appendChild(app.canvas);
  // the panel changes height between setup and play; keep the canvas matched to the stage box
  new ResizeObserver(() => app.resize()).observe(stage);
  const scene = new Scene(app);

  const { math, src } = await loadMath(makeRng());
  $('mathSrc').textContent = src;
  const round = new ChickenRound(math, wallet, LIMITS);

  let difficulty = 'medium';       // screen id; toMath() gives the repo's id
  let busy = false;
  let toastTimer = 0;
  const toast = (text: string, tone: '' | 'win' | 'lose' = '', ms = 2600) => {
    const t = $('toast'); t.textContent = text; t.className = `toast ${tone}`.trim(); t.hidden = false;
    clearTimeout(toastTimer); if (ms) toastTimer = window.setTimeout(() => { t.hidden = true; }, ms);
  };
  const renderBalance = () => {
    $('balance').textContent = money(wallet.get());
    const broke = wallet.get() < LIMITS.min;
    $<HTMLButtonElement>('play').hidden = broke || !$('run').hidden; $('reset').hidden = !broke;
  };
  const showRun = (on: boolean) => {
    $('run').hidden = !on; $('panel').classList.toggle('running', on);
    $<HTMLButtonElement>('play').hidden = on;
  };
  const parseBet = () => Math.max(0, parseFloat($<HTMLInputElement>('betInput').value.replace(/[^\d.]/g, '')) || 0);
  const setBet = (v: number) => { $<HTMLInputElement>('betInput').value = String(Math.round(v * 100) / 100); };
  const lanesFor = (d: string) => DIFFICULTY_LANES[toMath(d)];
  const preview = () => {
    $('chance').textContent = `${Math.round(collisionChance(toMath(difficulty)) * 100)}%`;
    scene.reset(lanesFor(difficulty), (n) => laneMultiplier(toMath(difficulty), n));
    scene.idle(true);
  };

  const refreshRun = () => {
    $<HTMLButtonElement>('cash').disabled = busy || round.lane < 1;
    $<HTMLButtonElement>('go').disabled = busy;
    $('cashAmt').textContent = round.lane >= 1 ? `${money2(round.bet * round.multiplier)} USD` : '';
  };

  const finish = async (kind: 'cash' | 'across' | 'bust') => {
    const r = round.settle();
    renderBalance();
    if (kind === 'bust') toast(`Lost ${money2(round.bet)}`, 'lose', 3200);
    else {
      scene.celebrate(r.win, kind === 'across' ? 'ACROSS!' : `×${r.multiplier.toFixed(2)}`);
      toast(`You won ${money2(r.win)}  (×${r.multiplier.toFixed(2)})`, 'win', 3200);
    }
    showRun(false);
    renderBalance();
    busy = false;
    if (kind !== 'bust') scene.idle(true);
  };

  $('difficulty').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-d]') as HTMLButtonElement | null;
    if (!b) return;
    difficulty = b.dataset.d!;
    document.querySelectorAll('#difficulty button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    preview();
  });
  $('chips').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button[data-v]') as HTMLButtonElement | null; if (b) setBet(Number(b.dataset.v)); });
  $('betMin').addEventListener('click', () => setBet(LIMITS.min));
  $('betMax').addEventListener('click', () => setBet(Math.min(LIMITS.max, wallet.get())));
  $('reset').addEventListener('click', () => { wallet.set(START); renderBalance(); toast('Play money refilled', 'win'); });
  $('menu').addEventListener('click', () => { wallet.set(START); renderBalance(); toast('Play money refilled', 'win'); });
  $('full').addEventListener('click', () => { document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.().catch(() => {}); });

  const rules = $<HTMLDialogElement>('rules');
  $('how').addEventListener('click', () => {
    $('rulesNote').textContent = 'Each hop is survived with a fixed chance (Easy 95%, Medium 90%, Hard 80%, Hardcore 60%). After n hops the multiplier is 0.99 ÷ chance^n. Play money only.';
    rules.showModal?.();
  });
  $('rulesClose').addEventListener('click', () => rules.close());

  $('play').addEventListener('click', () => {
    try { round.open(parseBet(), toMath(difficulty)); }
    catch (e) { toast(e instanceof RgsError ? e.message : 'Could not start the round', 'lose'); return; }
    $('toast').hidden = true;
    renderBalance();
    scene.reset(round.lanes, (n) => laneMultiplier(round.difficulty, n));
    scene.idle(true);
    showRun(true);
    busy = false;
    refreshRun();
  });

  $('go').addEventListener('click', async () => {
    if (busy || round.phase !== 'open') return;
    busy = true; refreshRun(); scene.idle(false);
    const r = round.cross();
    if (r.safe) {
      await scene.hopSafe(r.lane);
      if (r.finished) { await scene.finishRun(); return finish('across'); }
      busy = false; scene.idle(true); refreshRun();
    } else {
      await scene.hopBust(r.lane);
      await finish('bust');
    }
  });

  $('cash').addEventListener('click', async () => {
    if (busy || round.phase !== 'open' || round.lane < 1) return;
    busy = true; refreshRun(); await finish('cash');
  });

  // a round abandoned by closing the tab folds at its current value (the repo's settle-at-current autoclose)
  addEventListener('pagehide', () => { round.autoclose(); });

  preview();
  renderBalance();
  (window as any).__chicken = { round, scene, math };
  document.documentElement.dataset.ready = '1';
}

boot().catch((e) => { console.error(e); const t = $('toast'); t.hidden = false; t.textContent = 'Failed to start: ' + (e?.message ?? e); });
