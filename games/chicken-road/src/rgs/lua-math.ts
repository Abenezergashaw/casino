// Browser/Node runner for open-rgs Lua math. Mirrors @open-rgs/core's loadLuaMath (same host surface,
// same json/params prelude, same open/step/close/autoclose calls) without its Bun-only file and crypto APIs.
import { LuaFactory } from 'wasmoon';

export interface Op { kind: string; action: string; [k: string]: unknown }
export interface Awaiting { type: string; prompt?: string }
export interface OpenOutcome { state: string; ops: Op[]; awaiting?: Awaiting }
export interface StepOutcome { state: string; ops: Op[]; awaiting?: Awaiting }
export interface CloseOutcome { multiplier: number; type: string; ops: Op[] }

export interface ComplexMath {
  name: string;
  rtp: number;
  open(ctx: { params: Record<string, unknown> }): OpenOutcome;
  step(state: string, action: { type: string }): StepOutcome;
  isTerminal(state: string): boolean;
  close(state: string): CloseOutcome;
  autoclose(state: string): CloseOutcome;
}

export interface LuaSources { math: string; json: string; params: string }

export async function loadLuaMath(src: LuaSources, rng: () => number, wasmUrl?: string): Promise<ComplexMath> {
  const factory = wasmUrl ? new LuaFactory(wasmUrl) : new LuaFactory();
  // enableProxy:false hands Lua real tables; with the default proxies params.lua never sees the client params
  const lua = await factory.createEngine({ enableProxy: false });
  lua.global.set('__rgs_rng', () => rng());
  await lua.doString(`
    local noop = function() end
    host = { rng_next = __rgs_rng, log_debug = noop,
      mark = { count = noop, observe = noop, tag = noop, contribute = noop } }
    __rgs_rng = nil
  `);
  const body = `local params = (function()\n${src.params}\nend)()\nlocal json = (function()\n${src.json}\nend)()\n${src.math}`;
  await lua.doString(`__math = (function() ${body} end)()`);
  await lua.doString(`function __invoke(name, ...) return __math[name](...) end`);
  const call = lua.global.get('__invoke') as (name: string, ...a: unknown[]) => any;
  const meta = lua.global.get('__math') as { name?: string; rtp?: number };

  const plain = <T>(v: any): T => JSON.parse(JSON.stringify(v ?? null));
  return {
    name: String(meta.name ?? 'math'),
    rtp: Number(meta.rtp ?? 0),
    open: (ctx) => plain(call('open', undefined, ctx)),
    step: (state, action) => plain(call('step', state, action)),
    isTerminal: (state) => Boolean(call('is_terminal', state)),
    close: (state) => plain(call('close', state)),
    autoclose: (state) => plain(call('autoclose', state)),
  };
}
