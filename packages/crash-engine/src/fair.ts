// Provably-fair crash point derivation, shared by every crash-style game.
// Pure function over an injected HMAC so it runs in Node and in the browser.

export type HmacSha256Hex = (key: string, message: string) => string;

const HOUSE_EDGE_DIVISOR = 33; // ~3% instant-crash chance, same scheme Bustabit popularised

/** Returns the crash multiplier (>= 1.00) for a given seed triple. */
export function crashPoint(hmac: HmacSha256Hex, serverSeed: string, clientSeed: string, nonce: number): number {
  const h = hmac(serverSeed, `${clientSeed}:${nonce}`);
  const first52 = parseInt(h.slice(0, 13), 16); // 52 bits
  if (first52 % HOUSE_EDGE_DIVISOR === 0) return 1;
  const e = 2 ** 52;
  return Math.floor((100 * e - first52) / (e - first52)) / 100;
}

/** Multiplier shown at `ms` after take-off. Monotonic, exponential growth. */
export function multiplierAt(ms: number): number {
  const m = Math.exp(0.00006 * ms);
  return Math.max(1, Math.floor(m * 100) / 100);
}

/** Inverse of multiplierAt: ms until the plane reaches multiplier `m`. */
export function msUntil(m: number): number {
  return Math.log(m) / 0.00006;
}
