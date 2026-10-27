export * from './cards';
export * from './sets';
export * from './scoring';
export * from './arrange';

import { bestArrangement } from './arrange';
import type { Card } from './cards';
import { settle, unusedPoints, valuePoints, type Payment } from './scoring';

export interface PlayerHand {
  sets: Card[][];
  loose: Card[];
  /** Has this player seen the joker? Decides which sets are valid for them. */
  seenJoker: boolean;
}

export interface PlayerRoundResult {
  value: number;
  marriages: number;
  unusedSum: number;
  unused: number;
  /**
   * The hand as scored: the declarer's own arrangement, or for everyone else the automatic
   * best arrangement (SPEC 6, confirmed 2026-10-27).
   */
  sets: Card[][];
  loose: Card[];
}

/**
 * Full end-of-round scoring once someone declares.
 * Each other player's cards are arranged automatically into the valid sets that leave the
 * fewest unused points (how they arranged them on screen doesn't matter), then counted.
 */
export function scoreRound(
  hands: PlayerHand[],
  declarer: number,
  picked: Card,
): { results: PlayerRoundResult[]; payments: Payment[]; net: number[] } {
  const results = hands.map((h, i): PlayerRoundResult => {
    const all = [...h.sets.flat(), ...h.loose];
    const v = valuePoints(all, picked);
    if (i === declarer) {
      return { value: v.points, marriages: v.marriages, unusedSum: 0, unused: 0, sets: h.sets, loose: h.loose };
    }
    const arranged = bestArrangement(all, picked, h.seenJoker);
    const u = unusedPoints(arranged.loose, picked);
    return {
      value: v.points,
      marriages: v.marriages,
      unusedSum: u.sum,
      unused: u.points,
      sets: arranged.sets,
      loose: arranged.loose,
    };
  });
  const { payments, net } = settle(declarer, results);
  return { results, payments, net };
}
