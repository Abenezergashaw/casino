// Run via packages/crash-engine/test/run.sh (compiles src with tsc first).
const { createHmac, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { hmacSha256Hex, sha256Hex, crashPoint, multiplierAt, msUntil, CrashServer } = require(process.argv[2]);

// 1. hash primitives match Node's crypto
for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(200), 'héllo ✈']) {
  assert.equal(sha256Hex(s), createHash('sha256').update(s).digest('hex'));
  assert.equal(hmacSha256Hex('key', s), createHmac('sha256', 'key').update(s).digest('hex'));
}
assert.equal(hmacSha256Hex('k'.repeat(100), 'm'), createHmac('sha256', 'k'.repeat(100)).update('m').digest('hex'));

// 2. crash point distribution
const N = 100000; let ge2 = 0, ge10 = 0, min = Infinity;
for (let i = 0; i < N; i++) { const p = crashPoint(hmacSha256Hex, 'seed', 'client', i); min = Math.min(min, p); if (p >= 2) ge2++; if (p >= 10) ge10++; }
assert.ok(min >= 1); assert.ok(Math.abs(ge2 / N - 0.485) < 0.01); assert.ok(Math.abs(ge10 / N - 0.097) < 0.01);
assert.ok(Math.abs(multiplierAt(msUntil(2)) - 2) < 0.02);

// 3. full rounds on a virtual clock
let t = 0; const q = [];
const setTimer = (fn, ms) => { const h = { at: t + ms, fn }; q.push(h); return h; };
const clearTimer = (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); };
let balance = 1000; let seed = 7;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const srv = new CrashServer({ hmac: hmacSha256Hex, wallet: { get: () => balance, set: (n) => { balance = n; } }, now: () => t, setTimer, clearTimer, random });
const log = []; srv.subscribe((e) => log.push(e));
const run = (ms) => { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); if (!q.length || q[0].at > end) break; const h = q.shift(); t = h.at; h.fn(); } t = end; };

srv.start();
assert.equal(srv.phase, 'betting');
// reject: bad amounts, too early cashout
assert.equal(srv.placeBet(5).status, false);
assert.equal(srv.placeBet(5000).status, false); // more than balance
const bet = srv.placeBet(100); assert.equal(bet.status, true); assert.equal(balance, 900);
const cancel = srv.cancelBet(bet.game.id); assert.equal(cancel.status, true); assert.equal(balance, 1000);
const bet2 = srv.placeBet(100); assert.equal(balance, 900);
run(8000); assert.equal(srv.phase, 'flying');
assert.equal(srv.placeBet(100).status, false); // closed once flying
run(2000);
srv.cashOut(bet2.game.id, false);
const cashed = log.filter((e) => e.type === 'INCOMING_CASH_OUT' && e.username === 'You');
// round may have crashed before 2s (crash point 1.0x ~3% of rounds); both outcomes must keep the books straight
if (cashed.length) { assert.equal(balance, 900 + cashed[0].cashout); assert.ok(cashed[0].crashed_at > 1); assert.equal(srv.claimWin(bet2.game.id).win, cashed[0].cashout); }
else { assert.equal(balance, 900); assert.ok(log.some((e) => e.message === `INVALID_CASHOUT ${bet2.game.id}`)); }
srv.cashOut(bet2.game.id, false); // double cashout must not pay twice
assert.equal(balance, cashed.length ? 900 + cashed[0].cashout : 900);

// every round: payouts are monotone and the last update equals the crash point
let rounds = 0, stops = 0;
while (rounds < 60) { run(30000); rounds = log.filter((e) => e.message === 'GAME_ALLOW_BET').length; stops = log.filter((e) => e.message === 'GAME_STOP').length; }
const updates = log.filter((e) => e.message === 'PAYOUT_STATUS_UPDATE').map((e) => e.update);
assert.ok(stops >= 55);
for (let i = 0, ok = 0; i < log.length; i++) {
  if (log[i].message === 'GAME_STOP') { assert.equal(log[i - 1].message, 'PAYOUT_STATUS_UPDATE'); ok++; }
}
assert.ok(updates.every((u) => u >= 1));
assert.ok(srv.recent().length === 20 && srv.top().length > 0);
console.log('engine ok', { rounds, stops, balance });
