// Cross-check against the REAL @open-rgs/core loader (Bun-only): bun test/real-core.ts
import { loadLuaMath } from '@open-rgs/core';
import { exampleExtensions } from '../../../vendor/open-rgs-examples/packages/lua-kit/src/index.ts';

const math: any = await loadLuaMath(new URL('../../../vendor/open-rgs-examples/games/chicken-road/maths/chicken-road.lua', import.meta.url).pathname, { extensions: exampleExtensions, timeoutMs: 1000 });
for (const d of ['easy', 'medium', 'hard', 'daredevil']) {
  const o = await math.open(undefined, { params: { difficulty: d } });
  console.log(d.padEnd(10), o.state);
}
