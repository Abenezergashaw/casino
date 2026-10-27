// Copies the unmodified open-rgs Lua files into src/rgs/lua so the app bundles exactly what the repo ships.
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const v = join(here, '../../../vendor/open-rgs-examples');
const out = join(here, '../src/rgs/lua');
mkdirSync(out, { recursive: true });
for (const [from, to] of [
  ['games/chicken-road/maths/chicken-road.lua', 'chicken-road.lua'],
  ['packages/lua-kit/src/json.lua', 'json.lua'],
  ['packages/lua-kit/src/params.lua', 'params.lua'],
]) {
  cpSync(join(v, from), join(out, to));
  console.log(to, createHash('sha256').update(readFileSync(join(v, from))).digest('hex').slice(0, 12));
}

// wasmoon's Lua VM; the app fetches it next to index.html
const wasm = join(here, '../node_modules/wasmoon/dist/glue.wasm');
mkdirSync(join(here, '../public'), { recursive: true });
cpSync(wasm, join(here, '../public/glue.wasm'));
console.log('glue.wasm copied');
