// Value points, unused-card points and settlement. See SPEC.md sections 4 and 6.

import { type Card, isJoker, valueRole } from './cards';

// ---------- Value points (joker 7♥ example: 6♥ = low, 7♥ = tiplu, 8♥ = high) ----------
// Confirmed by Vikram:
//   7♥ = 3, 6♥ or 8♥ = 2, 6♥+8♥ = 4, 6♥+7♥ = 5
//   6♥6♥ = 5, 8♥8♥ = 5, 7♥7♥ = 8
//   marriage = 10: 6♥7♥8♥, 6♥6♥6♥, 8♥8♥8♥; several allowed
//   6♥6♥7♥ = 66 + 7 = 8; 6♥6♥7♥8♥ = marriage + 6 = 12 (grouping with the most points)
// Only two 7♥ can be in play (the third is the picked joker, out of play).

export const VALUE = {
  tiplu: 3,
  neighbour: 2,
  pair: 5, // two identical neighbours (6♥6♥ or 8♥8♥)
  tipluPair: 8, // 7♥7♥ (confirmed 2026-10-27; was 5)
  marriage: 10, // low + tiplu + high, or three identical low / high
} as const;

/** Points for low or high cards of one kind held `n` times (0..3), outside marriages. */
function neighbourPoints(n: number): number {
  if (n >= 3) return VALUE.marriage; // 666 or 888
  if (n === 2) return VALUE.pair;
  return n * VALUE.neighbour;
}

/** Points for tiplus held `n` times (0..2), outside marriages. */
function tipluPoints(n: number): number {
  if (n >= 2) return VALUE.tipluPair; // 77 = 8
  return n * VALUE.tiplu;
}

export interface ValueBreakdown {
  points: number;
  low: number;
  tiplu: number;
  high: number;
  marriages: number;
}

/**
 * Value points for every card a player holds (sets AND loose cards).
 * Tries every number of low-tiplu-high marriages and keeps the best total.
 */
export function valuePoints(cards: Card[], picked: Card): ValueBreakdown {
  let low = 0;
  let tiplu = 0;
  let high = 0;
  for (const c of cards) {
    const role = valueRole(c, picked);
    if (role === 'low') low++;
    else if (role === 'tiplu') tiplu++;
    else if (role === 'high') high++;
  }
  let best = { points: 0, marriages: 0 };
  const maxM = Math.min(low, tiplu, high);
  for (let m = 0; m <= maxM; m++) {
    const pts =
      m * VALUE.marriage + neighbourPoints(low - m) + neighbourPoints(high - m) + tipluPoints(tiplu - m);
    if (pts > best.points) best = { points: pts, marriages: m };
  }
  return { points: best.points, low, tiplu, high, marriages: best.marriages };
}

// ---------- Unused cards ----------

/** A, K, Q, J = 10; 2-10 = face value. */
export function cardPoints(card: Card): number {
  return card.rank === 1 || card.rank >= 11 ? 10 : card.rank;
}

export const UNUSED_CAP = 10;

/**
 * Points for cards NOT in a valid set. Jokers are removed first.
 * Sum ÷ 10, rounded half down (23 → 2, 25 → 2, 26 → 3), capped at 10.
 */
export function unusedPoints(unused: Card[], picked: Card): { sum: number; points: number } {
  const sum = unused.filter((c) => !isJoker(c, picked)).reduce((a, c) => a + cardPoints(c), 0);
  const points = Math.min(UNUSED_CAP, Math.floor((sum + 4) / 10));
  return { sum, points };
}

// ---------- Settlement ----------

export interface PlayerResult {
  /** Value points from valuePoints(). */
  value: number;
  /** Unused-card points from unusedPoints(). Ignored for the declarer. */
  unused: number;
}

export interface Payment {
  player: number;
  /** Positive: this player pays the declarer. Negative: the declarer pays this player. */
  toDeclarer: number;
}

/**
 * Each other player pays the declarer: own unused points + declarer's value points − own value points.
 * A negative amount means the declarer pays them (confirmed: "yes, I pay him 10").
 */
export function settle(declarer: number, players: PlayerResult[]): { payments: Payment[]; net: number[] } {
  const d = players[declarer];
  if (!d) throw new Error(`No player ${declarer}`);
  const net = players.map(() => 0);
  const payments: Payment[] = [];
  players.forEach((p, i) => {
    if (i === declarer) return;
    const amount = p.unused + d.value - p.value;
    payments.push({ player: i, toDeclarer: amount });
    net[i] = (net[i] as number) - amount;
    net[declarer] = (net[declarer] as number) + amount;
  });
  return { payments, net };
}
