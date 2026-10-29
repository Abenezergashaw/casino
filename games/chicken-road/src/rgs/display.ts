// Display helpers read the math's own exports, so the screen prints exactly what the math pays.
import { DIFFICULTY, RTP, multiplierAfter, parseDifficulty } from '../../maths/chicken-road.ts';

export { RTP };
/** Multiplier after `lane` lanes, as the math computes it. */
export const laneMultiplier = (difficulty: string, lane: number) => multiplierAfter(parseDifficulty(difficulty), lane);
/** Chance of being hit on any one lane. */
export const collisionChance = (difficulty: string) => 1 - DIFFICULTY[parseDifficulty(difficulty)].p;
export const lanesFor = (difficulty: string) => DIFFICULTY[parseDifficulty(difficulty)].lanes;
