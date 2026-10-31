// Pairs ("duplicates") and packing (confirmed 2026-10-31). See SPEC.md section 5b.

import { type Card, sameCard } from './cards';

/**
 * One pair = two identical cards (same rank AND suit, possible with 3 decks).
 * Three identical cards count as one pair (the third is spare).
 */
export function pairsOf(cards: Card[]): Card[][] {
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const key = `${c.rank}${c.suit}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const pairs: Card[][] = [];
  for (const g of groups.values()) if (g.length >= 2) pairs.push([g[0] as Card, g[1] as Card]);
  return pairs;
}

export function countPairs(cards: Card[]): number {
  return pairsOf(cards).length;
}

/** How many pairs you need. First turn: before drawing. Later: once everyone has had a turn, after drawing. */
export const PAIRS = {
  firstTurn: { pack: 5, declare: 6 },
  later: { pack: 6, declare: 7 },
} as const;

/** Card points a packed player pays: none after packing with pairs, 5 after packing any time. */
export const PACK_POINTS = { pairs: 0, any: 5 } as const;

export const isPair = (cards: Card[]) => cards.length === 2 && sameCard(cards[0] as Card, cards[1] as Card);
