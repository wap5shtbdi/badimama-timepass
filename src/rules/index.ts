export * from './cards';
export * from './sets';
export * from './scoring';

import type { Card } from './cards';
import { checkSet } from './sets';
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
}

/** Cards that count as unused: loose cards plus cards in sets that aren't valid for this player. */
export function unusedCards(hand: PlayerHand, picked: Card): Card[] {
  const ctx = hand.seenJoker ? picked : null;
  const fromBadSets = hand.sets.filter((s) => !checkSet(s, ctx).valid).flat();
  return [...hand.loose, ...fromBadSets];
}

/** Full end-of-round scoring once someone declares. */
export function scoreRound(
  hands: PlayerHand[],
  declarer: number,
  picked: Card,
): { results: PlayerRoundResult[]; payments: Payment[]; net: number[] } {
  const results = hands.map((h, i) => {
    const all = [...h.sets.flat(), ...h.loose];
    const v = valuePoints(all, picked);
    const u = i === declarer ? { sum: 0, points: 0 } : unusedPoints(unusedCards(h, picked), picked);
    return { value: v.points, marriages: v.marriages, unusedSum: u.sum, unused: u.points };
  });
  const { payments, net } = settle(declarer, results);
  return { results, payments, net };
}
