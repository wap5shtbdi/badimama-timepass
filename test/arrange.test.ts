import { describe, expect, it } from 'vitest';
import {
  bestArrangement,
  type Card,
  cardPoints,
  checkSet,
  deal,
  isJoker,
  parseCard,
  parseCards as c,
  unusedPoints,
} from '../src/rules';

const J = parseCard('7H'); // jokers: all 7s, 6♥, 8♥

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const keys = (cards: Card[]) => cards.map((x) => (x.rank === 1 ? 'A' : x.rank > 10 ? 'JQK'[x.rank - 11] : x.rank) + x.suit);
const unusedSum = (cards: Card[], picked: Card = J) => unusedPoints(cards, picked).sum;

/** Exhaustive: every way to group the cards into valid sets of ANY size (or leave them loose). */
function bruteMinUnused(cards: Card[], seen: boolean, picked: Card): number {
  const ctx = seen ? picked : null;
  const w = (x: Card) => (isJoker(x, picked) ? 0 : cardPoints(x));
  const go = (rest: Card[]): number => {
    if (rest.length === 0) return 0;
    const [first, ...others] = rest as [Card, ...Card[]];
    let best = w(first) + go(others); // first stays loose
    const m = others.length;
    for (let mask = 1; mask < 1 << m; mask++) {
      const block = [first, ...others.filter((_, i) => mask & (1 << i))];
      if (block.length < 3 || !checkSet(block, ctx).valid) continue;
      best = Math.min(best, go(others.filter((_, i) => !(mask & (1 << i)))));
    }
    return best;
  };
  return go(cards);
}

describe('one natural card + jokers (bug fixed 2026-10-27)', () => {
  it('K♦ + two jokers is a joker sequence, valid after seeing the joker', () => {
    expect(checkSet(c('KD 7C 6H'), J)).toMatchObject({ valid: true, kind: 'sequenceWithJoker', countsForMinimum: false });
    expect(checkSet(c('5S 7C 7D'), J).valid).toBe(true);
    expect(checkSet(c('AS 7C 8H 7D'), J).valid).toBe(true); // A + 3 jokers: A-2-3-4
  });

  it('still: jokers never complete a suited trail, and nothing is wild before seeing', () => {
    expect(checkSet(c('KC KC 7S'), J).valid).toBe(false);
    expect(checkSet(c('KD 7C 6H'), null).valid).toBe(false);
  });
});

describe('automatic arrangement for scoring', () => {
  it('finds sets the player left loose', () => {
    const r = bestArrangement(c('QS 4S KD 5S 3D 6S 2D AD'), J, false);
    expect(r.sets.map(keys)).toEqual([['4S', '5S', '6S'], ['3D', '2D', 'AD']]);
    expect(keys(r.loose)).toEqual(['QS', 'KD']);
  });

  it('uses jokers only if the player has seen the joker', () => {
    const cards = c('KD QD 7C 9S');
    expect(unusedSum(bestArrangement(cards, J, true).loose)).toBe(9);
    expect(unusedSum(bestArrangement(cards, J, false).loose)).toBe(29);
  });

  it('prefers the grouping that leaves the fewest points, not the most sets', () => {
    // A♥ 2♥ 3♥ or Q♥ K♥ A♥: using the Ace high leaves 2 + 3 = 5 instead of Q + K = 20.
    const r = bestArrangement(c('2H 3H QH KH AH'), J, false);
    expect(keys(r.loose).sort()).toEqual(['2H', '3H']);
  });

  it('keeps every card exactly once', () => {
    const d = deal(4, seeded(7));
    for (const hand of d.hands) {
      const r = bestArrangement(hand, J, true);
      const ids = [...r.sets.flat(), ...r.loose].map((x) => x.id).sort();
      expect(ids).toEqual(hand.map((x) => x.id).sort());
      for (const s of r.sets) expect(checkSet(s, J).valid).toBe(true);
    }
  });

  it('matches an exhaustive search over every grouping (random small hands)', () => {
    // A small pool so sets, overlaps and jokers are common.
    const pools: [Card, Card[]][] = [
      [J, c('AS 2S 3S 4S 5S 6S 7S 2H 3H 6H 7H 8H 9H 3D 4D 5D 7D 3C 7C KC KD QD 6C 6C 8S 8S')],
      [parseCard('AH'), c('AS AD AC 2H KH QH JH 2S 3S 4S KS QS 2D 3D KC KC 10H 9H 3H AC')],
    ];
    const rnd = seeded(42);
    for (const [picked, pool] of pools) {
      for (let t = 0; t < 500; t++) {
        const n = 4 + Math.floor(rnd() * 6); // 4–9 cards
        const hand = [...pool].sort(() => rnd() - 0.5).slice(0, n).map((x, i) => ({ ...x, id: `${t}-${i}` }));
        for (const seen of [true, false]) {
          const got = unusedSum(bestArrangement(hand, picked, seen).loose, picked);
          expect(got, `${keys(hand).join(' ')} seen=${seen}`).toBe(bruteMinUnused(hand, seen, picked));
        }
      }
    }
  });

  it('is fast on real 21/22-card hands, including joker-heavy ones', () => {
    const start = Date.now();
    let worst = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const d = deal(5, seeded(seed));
      for (const hand of d.hands) {
        const withDraw = [...hand, d.stock[0]!];
        for (const seen of [true, false]) {
          const t0 = Date.now();
          bestArrangement(withDraw, J, seen);
          worst = Math.max(worst, Date.now() - t0);
        }
      }
    }
    // A hand stuffed with jokers and hearts near the joker.
    const heavy = c('7S 7S 7C 7C 7D 7D 6H 6H 8H 8H 5H 9H 10H 4H 3H AS 2S 3S KD QD JD 9C');
    const t0 = Date.now();
    const r = bestArrangement(heavy, J, true);
    worst = Math.max(worst, Date.now() - t0);
    expect(unusedSum(r.loose)).toBe(0);
    expect(worst).toBeLessThan(500); // per hand; a declare scores up to 4 hands
    expect(Date.now() - start).toBeLessThan(8_000);
  }, 20_000);
});
