// Automatic arrangement for scoring (SPEC 6, confirmed 2026-10-27): when someone declares, each
// other player's cards are arranged automatically into the valid sets that leave the fewest
// unused card points, then the unused cards are counted.

import { type Card, isJoker } from './cards';
import { checkSet } from './sets';
import { cardPoints } from './scoring';

export interface Arrangement {
  sets: Card[][];
  loose: Card[];
}

/** Largest hand we arrange (22 = 21 + a drawn card). Keeps bitmasks well inside 32 bits. */
export const MAX_ARRANGE = 24;

/**
 * Arrange `cards` into valid sets so the unused card sum (jokers removed) is as small as possible.
 *
 * Validity follows the player: if they haven't seen the joker, only pure sequences and identical
 * trails count (no wildcards); jokers are still removed from the unused sum (SPEC 6).
 *
 * Exact search. Only sets of 3–5 cards are tried: every valid longer set can be split into valid
 * sets of 3–5 covering the same cards (runs split into shorter runs; same-rank groups split into
 * groups of 3+, and at most 3 identical cards exist; joker cards always form a valid group).
 * The tests check this against a search over every possible grouping.
 */
export function bestArrangement(cards: Card[], picked: Card, seenJoker: boolean): Arrangement {
  const n = cards.length;
  if (n > MAX_ARRANGE) throw new Error(`Too many cards to arrange: ${n}`);
  const ctx = seenJoker ? picked : null;
  const weight = cards.map((c) => (isJoker(c, picked) ? 0 : cardPoints(c)));

  // All valid sets of 3–5 cards that cover some points, listed under every point-carrying card
  // they contain. Jokers carry no points (removed before summing), so the search only has to
  // decide, for each point-carrying card, "unused" or "in which set"; jokers just get used up.
  type Cand = { mask: number; weight: number };
  const containing: Cand[][] = Array.from({ length: n }, () => []);
  // In every valid set the cards that aren't wildcards share a suit or a rank (pure or joker
  // sequence, trail, off-suit trail, all-joker set), so other combinations are skipped early.
  // Before seeing the joker there are no wildcards: every card counts.
  const wild = cards.map((x) => seenJoker && isJoker(x, picked));
  const pick: number[] = [];
  const fits = (i: number): boolean => {
    if (wild[i]) return true;
    const x = cards[i] as Card;
    let sameSuit = true;
    let sameRank = true;
    for (const p of pick) {
      if (wild[p]) continue;
      const y = cards[p] as Card;
      if (y.suit !== x.suit) sameSuit = false;
      if (y.rank !== x.rank) sameRank = false;
    }
    return sameSuit || sameRank;
  };
  const build = (start: number) => {
    if (pick.length >= 3) {
      const set = pick.map((i) => cards[i] as Card);
      const w = pick.reduce((a, i) => a + (weight[i] as number), 0);
      if (w > 0 && checkSet(set, ctx).valid) {
        const cand = { mask: pick.reduce((m, i) => m | (1 << i), 0), weight: w };
        for (const i of pick) if ((weight[i] as number) > 0) (containing[i] as Cand[]).push(cand);
      }
    }
    if (pick.length === 5) return;
    for (let i = start; i < n; i++) {
      if (!fits(i)) continue;
      pick.push(i);
      build(i + 1);
      pick.pop();
    }
  };
  build(0);
  // Bigger sets first: a full cover is found early, which lets the search stop (below).
  for (const list of containing) list.sort((a, b) => b.weight - a.weight);

  const pointMask = weight.reduce((m, w, i) => (w > 0 ? m | (1 << i) : m), 0);
  const weightOf = (mask: number): number => {
    let w = 0;
    for (let m = mask & pointMask; m !== 0; m &= m - 1) w += weight[31 - Math.clz32(m & -m)] as number;
    return w;
  };

  // Best covered weight for the cards still in `mask`, remembering the choice made.
  const memo = new Map<number, { covered: number; set: number; card: number }>();
  const solve = (mask: number): number => {
    const points = mask & pointMask;
    if (points === 0) return 0; // only jokers left: nothing more to cover
    const hit = memo.get(mask);
    if (hit) return hit.covered;
    const card = 31 - Math.clz32(points & -points); // lowest point-carrying card still to place
    // Nothing can cover more than all remaining points; once reached, stop (keeps it exact).
    const ceiling = weightOf(mask);
    let best = -1;
    let bestSet = 0;
    // Option 1: put it in a set made only of cards still available.
    for (const cand of containing[card] as Cand[]) {
      if ((cand.mask & mask) !== cand.mask) continue;
      const covered = cand.weight + solve(mask & ~cand.mask);
      if (covered > best) {
        best = covered;
        bestSet = cand.mask;
        if (best === ceiling) break;
      }
    }
    // Option 2: leave it unused.
    if (best < ceiling) {
      const covered = solve(mask & ~(1 << card));
      if (covered > best) {
        best = covered;
        bestSet = 0;
      }
    }
    memo.set(mask, { covered: best, set: bestSet, card });
    return best;
  };
  const all = (1 << n) - 1;
  solve(all);

  // Rebuild the chosen sets; whatever no set used (incl. spare jokers) stays loose.
  const sets: Card[][] = [];
  let mask = all;
  while ((mask & pointMask) !== 0) {
    const step = memo.get(mask) as { set: number; card: number };
    if (step.set === 0) {
      mask &= ~(1 << step.card);
    } else {
      sets.push(cards.filter((_, i) => step.set & (1 << i)));
      mask &= ~step.set;
    }
  }
  const inSets = sets.flat();
  return { sets, loose: cards.filter((x) => !inSets.includes(x)) };
}
