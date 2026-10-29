// Copies the unmodified open-rgs Lua files into test/lua. The Lua is only the REFERENCE the TypeScript port is
// proven equal to (test/math.test.ts); the shipped game runs maths/chicken-road.ts.
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const v = join(here, '../../../vendor/open-rgs-examples');
const out = join(here, '../test/lua');
mkdirSync(out, { recursive: true });
for (const [from, to] of [
  ['games/chicken-road/maths/chicken-road.lua', 'chicken-road.lua'],
  ['packages/lua-kit/src/json.lua', 'json.lua'],
  ['packages/lua-kit/src/params.lua', 'params.lua'],
]) {
  cpSync(join(v, from), join(out, to));
  console.log(to, createHash('sha256').update(readFileSync(join(v, from))).digest('hex').slice(0, 12));
}
