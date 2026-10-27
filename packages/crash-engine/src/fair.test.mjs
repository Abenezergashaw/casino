import { createHmac } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { crashPoint, multiplierAt, msUntil } from './fair.ts';

const hmac = (k, m) => createHmac('sha256', k).update(m).digest('hex');

// deterministic
assert.equal(crashPoint(hmac, 's', 'c', 1), crashPoint(hmac, 's', 'c', 1));

// distribution sanity over 100k rounds: P(crash >= x) ~= 0.97 / x
const N = 100000;
let ge2 = 0, ge10 = 0, min = Infinity;
for (let i = 0; i < N; i++) {
  const p = crashPoint(hmac, 'seed', 'client', i);
  min = Math.min(min, p);
  if (p >= 2) ge2++;
  if (p >= 10) ge10++;
}
console.log({ min, p_ge_2: ge2 / N, p_ge_10: ge10 / N });
assert.ok(min >= 1);
assert.ok(Math.abs(ge2 / N - 0.485) < 0.01);
assert.ok(Math.abs(ge10 / N - 0.097) < 0.01);

// growth curve round-trips
assert.equal(multiplierAt(0), 1);
assert.ok(Math.abs(multiplierAt(msUntil(2)) - 2) < 0.02);
console.log('ok');
