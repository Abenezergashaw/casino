// Display-only: lane tags are printed before the math has been asked. Real payouts always come from the
// math's close(); test/math.test.ts checks this table against the Lua's own multipliers.
// Keys are the repo's difficulty ids; the screen calls "daredevil" Hardcore, as the reference game does.
export const DIFFICULTY_P: Record<string, number> = { easy: 0.95, medium: 0.9, hard: 0.8, daredevil: 0.6 };
export const DIFFICULTY_LANES: Record<string, number> = { easy: 20, medium: 20, hard: 16, daredevil: 12 };
export const RTP = 0.99;
export const laneMultiplier = (difficulty: string, lane: number) => RTP / (DIFFICULTY_P[difficulty] ?? 0.9) ** lane;
export const collisionChance = (difficulty: string) => 1 - (DIFFICULTY_P[difficulty] ?? 0.9);
