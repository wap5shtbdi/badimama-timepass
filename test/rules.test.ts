// Every test here comes from a rule Vikram confirmed (see SPEC.md). Joker in examples: 7♥.
import { describe, expect, it } from 'vitest';
import {
  canDeclare,
  canShow,
  checkSet,
  deal,
  isJoker,
  makeShoe,
  meetsMinimum,
  parseCard,
  parseCards as c,
  scoreRound,
  settle,
  unusedPoints,
  valuePoints,
  valueRole,
} from '../src/rules';

const J = parseCard('7H'); // the picked joker card

/** Deterministic random for repeatable deals. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('deck and deal', () => {
  it('uses 3 decks = 156 cards with unique ids', () => {
    const shoe = makeShoe();
    expect(shoe).toHaveLength(156);
    expect(new Set(shoe.map((x) => x.id)).size).toBe(156);
  });

  it.each([2, 3, 4, 5])('deals 21 cards each to %i players, 1 discard, rest in stock', (n) => {
    const d = deal(n, seeded(n));
    d.hands.forEach((h) => expect(h).toHaveLength(21));
    expect(d.discard).toHaveLength(1);
    expect(d.stock).toHaveLength(156 - 21 * n - 1);
    const ids = [...d.hands.flat(), ...d.stock, ...d.discard].map((x) => x.id);
    expect(new Set(ids).size).toBe(156);
  });

  it('rejects fewer than 2 or more than 5 players', () => {
    expect(() => deal(1, Math.random)).toThrow();
    expect(() => deal(6, Math.random)).toThrow();
  });
});

describe('jokers and value cards (joker 7♥)', () => {
  it('all 7s plus 6♥ and 8♥ are jokers', () => {
    for (const k of ['7S', '7H', '7D', '7C', '6H', '8H']) expect(isJoker(parseCard(k), J)).toBe(true);
    for (const k of ['6S', '8D', '5H', '9H']) expect(isJoker(parseCard(k), J)).toBe(false);
  });

  it('neighbours wrap around for Ace and King jokers', () => {
    const ace = parseCard('AH');
    expect(valueRole(parseCard('KH'), ace)).toBe('low');
    expect(valueRole(parseCard('2H'), ace)).toBe('high');
    const king = parseCard('KH');
    expect(valueRole(parseCard('QH'), king)).toBe('low');
    expect(valueRole(parseCard('AH'), king)).toBe('high');
  });

  it('a set made only of jokers is allowed after seeing the joker, not before', () => {
    expect(checkSet(c('6H 7S 8H'), J)).toMatchObject({ valid: true, kind: 'allJokers', countsForMinimum: false });
    expect(checkSet(c('6H 7S 8H'), null).valid).toBe(false);
  });

  it('only 6♥ 7♥ 8♥ are value cards', () => {
    expect(valueRole(parseCard('6H'), J)).toBe('low');
    expect(valueRole(parseCard('7H'), J)).toBe('tiplu');
    expect(valueRole(parseCard('8H'), J)).toBe('high');
    expect(valueRole(parseCard('7S'), J)).toBeNull();
  });
});

describe('sets before seeing the joker', () => {
  it('pure sequence of 3+ same suit is valid', () => {
    expect(checkSet(c('4S 5S 6S'), null)).toMatchObject({ valid: true, kind: 'sequence', pure: true });
    expect(checkSet(c('4S 5S 6S 7S'), null).valid).toBe(true);
  });

  it('Q-K-A and A-2-3 valid; K-A-2 invalid', () => {
    expect(checkSet(c('QS KS AS'), null).valid).toBe(true);
    expect(checkSet(c('AS 2S 3S'), null).valid).toBe(true);
    expect(checkSet(c('KS AS 2S'), null).valid).toBe(false);
  });

  it('mixed-suit sequence is never valid', () => {
    expect(checkSet(c('4S 5H 6S'), null).valid).toBe(false);
    expect(checkSet(c('4S 5H 6S'), J).valid).toBe(false);
  });

  it('trail = three identical cards', () => {
    expect(checkSet(c('KC KC KC'), null)).toMatchObject({ valid: true, kind: 'trail', pure: true });
  });

  it('no wildcards and no mixed-suit trails before seeing the joker', () => {
    expect(checkSet(c('4S 5S 7C'), null).valid).toBe(false);
    expect(checkSet(c('JS JD JH'), null).valid).toBe(false);
  });

  it('fewer than 3 cards is not a set', () => {
    expect(checkSet(c('4S 5S'), null).valid).toBe(false);
  });
});

describe('showing (to see the joker)', () => {
  it('needs 3 pure sequences or trails', () => {
    expect(canShow([c('4S 5S 6S'), c('9D 10D JD'), c('KC KC KC')])).toBe(true);
    expect(canShow([c('4S 5S 6S'), c('9D 10D JD')])).toBe(false);
    expect(canShow([c('4S 5S 6S'), c('9D 10D JD'), c('JS JD JH')])).toBe(false);
  });
});

describe('sets after seeing the joker (7♥)', () => {
  it('mixed-suit trail is valid but does not count toward the minimum', () => {
    expect(checkSet(c('JS JD JH'), J)).toMatchObject({ valid: true, kind: 'mixedTrail', countsForMinimum: false });
  });

  it('a joker can complete a mixed-suit trail (not counting)', () => {
    expect(checkSet(c('KC KD 7S'), J)).toMatchObject({ valid: true, kind: 'mixedTrailWithJoker', countsForMinimum: false });
  });

  it("a joker can't complete a suited trail", () => {
    expect(checkSet(c('KC KC 7S'), J).valid).toBe(false);
  });

  it('same-suit sequence with a joker is valid but does not count toward the minimum', () => {
    expect(checkSet(c('4S 5S 7C'), J)).toMatchObject({ valid: true, kind: 'sequenceWithJoker', countsForMinimum: false });
    expect(checkSet(c('2H 3H 7C'), J).valid).toBe(true);
    expect(checkSet(c('4S 6S 8H'), J).valid).toBe(true); // 8♥ fills the 5
  });

  it('6♥ 7♥ 8♥ is a pure sequence and a marriage', () => {
    expect(checkSet(c('6H 7H 8H'), J)).toMatchObject({ valid: true, kind: 'sequence', isMarriage: true });
  });
});

describe('minimum 3 counting sets after seeing the joker', () => {
  it('only natural sets count: pure sequences and identical trails, even of joker cards', () => {
    expect(meetsMinimum([c('4S 5S 6S'), c('9D 10D JD'), c('KC KC KC')], J)).toBe(true);
    expect(meetsMinimum([c('4S 5S 6S'), c('9D 10D JD'), c('6H 7H 8H')], J)).toBe(true); // pure, of value cards
    expect(meetsMinimum([c('4S 5S 6S'), c('9D 10D JD'), c('6H 6H 6H')], J)).toBe(true); // trail of surrounding cards
    expect(meetsMinimum([c('4S 5S 6S'), c('9D 10D JD'), c('7S 7S 7S')], J)).toBe(true); // trail of jokers
  });

  it('sets that need a joker, mixed-suit trails and all-joker sets do not count', () => {
    expect(meetsMinimum([c('4S 5S 6S'), c('9D 10D JD'), c('2H 3H 7C')], J)).toBe(false);
    expect(meetsMinimum([c('4S 5S 6S'), c('9D 10D JD'), c('JS JD JH')], J)).toBe(false);
    expect(meetsMinimum([c('4S 5S 6S'), c('9D 10D JD'), c('6H 7S 8H')], J)).toBe(false);
  });
});

describe('declaring', () => {
  const sets = [c('4S 5S 6S'), c('9D 10D JD'), c('AC 2C 3C'), c('KC KC KC'), c('6H 7H 8H'), c('QS QS 7S'), c('2D 3D 4D')];

  it('ok when all 21 cards are in valid sets and joker seen', () => {
    // QS QS 7S is a suited trail completed by a joker: invalid. Replace it.
    const good = [...sets.slice(0, 5), c('QS QD 7S'), c('2D 3D 4D')];
    expect(good.flat()).toHaveLength(21);
    expect(canDeclare(good, [], J)).toEqual({ ok: true });
  });

  it('refuses with loose cards, invalid sets, or without seeing the joker', () => {
    expect(canDeclare(sets.slice(0, 6), c('2D 3D 4D'), J).ok).toBe(false);
    expect(canDeclare(sets, [], J).ok).toBe(false);
    expect(canDeclare(sets, [], null).ok).toBe(false);
  });
});

describe('value points (joker 7♥)', () => {
  const v = (keys: string) => valuePoints(c(keys), J).points;

  it.each([
    ['7H', 3],
    ['6H', 2],
    ['8H', 2],
    ['6H 8H', 4],
    ['6H 7H', 5],
    ['7H 8H', 5],
    ['6H 6H', 5],
    ['8H 8H', 5],
    ['7H 7H', 8],
    ['6H 6H 7H 8H', 12], // marriage + single 6
    ['6H 7H 7H 8H', 13], // marriage + single 7 beats 6 + 77 + 8 = 12
    ['6H 7H 8H', 10],
    ['6H 6H 6H', 10],
    ['8H 8H 8H', 10],
    ['6H 6H 7H', 8],
    ['6H 7H 8H 6H 7H 8H', 20], // two marriages
    ['7S 7D 6S 8D QC', 0], // other jokers / non-value cards score nothing
  ])('%s = %i', (keys, expected) => {
    expect(v(keys)).toBe(expected);
  });
});

describe('unused card points', () => {
  it('A K Q J = 10, others face value; jokers removed', () => {
    expect(unusedPoints(c('AS KS QD JC'), J).sum).toBe(40);
    expect(unusedPoints(c('2S 9D 7C 6H 8H'), J).sum).toBe(11);
  });

  it.each([
    ['KS 9S 4S', 23, 2],
    ['KS 9S 6S', 25, 2],
    ['KS KD 6S', 26, 3],
    ['KS KD 9S 5S', 34, 3],
    ['KS KD KC QS QD QC JS JD 4S 3S', 87, 9],
    ['KS KD KC QS QD QC JS JD JC AS AD AC 6S', 126, 10],
    ['3S 2D', 5, 0],
    ['4S 2D', 6, 1],
  ])('%s: sum %i → %i points (half rounds down, max 10)', (keys, sum, pts) => {
    expect(unusedPoints(c(keys), J)).toEqual({ sum, points: pts });
  });
});

describe('settlement', () => {
  it("Vikram's example: declarer value 10; Mom unused 3, value 2 → pays 11", () => {
    const { payments } = settle(0, [
      { value: 10, unused: 0 },
      { value: 2, unused: 3 },
      { value: 5, unused: 9 },
      { value: 0, unused: 10 },
    ]);
    expect(payments).toEqual([
      { player: 1, toDeclarer: 11 },
      { player: 2, toDeclarer: 14 },
      { player: 3, toDeclarer: 20 },
    ]);
  });

  it('negative: Dad unused 2, declarer value 3, Dad value 15 → declarer pays Dad 10', () => {
    const { payments, net } = settle(0, [
      { value: 3, unused: 0 },
      { value: 15, unused: 2 },
    ]);
    expect(payments).toEqual([{ player: 1, toDeclarer: -10 }]);
    expect(net).toEqual([-10, 10]);
  });

  it('net always sums to zero', () => {
    const { net } = settle(1, [
      { value: 4, unused: 7 },
      { value: 10, unused: 0 },
      { value: 0, unused: 10 },
    ]);
    expect(net.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('full round scoring', () => {
  it('counts unused cards after automatic arrangement, and value points from ALL held cards', () => {
    const { results, payments } = scoreRound(
      [
        // Declarer: all valid, includes a marriage.
        {
          seenJoker: true,
          loose: [],
          sets: [c('4S 5S 6S'), c('9D 10D JD'), c('AC 2C 3C'), c('KC KC KC'), c('6H 7H 8H'), c('QS QD 7S'), c('2D 3D 4D')],
        },
        // Mom: saw joker. 3 good sets; loose K + 9 + 7C (joker, removed) + 6H (value card, also a joker, removed).
        {
          seenJoker: true,
          loose: c('KD 9C 7C 6H'),
          sets: [c('4D 5D 6D'), c('QC QC QC'), c('8S 9S 10S'), c('2S 3S 4S'), c('JS JD JH')],
        },
        // Dad: hasn't seen joker, so his joker-based set is invalid and its cards are unused.
        {
          seenJoker: false,
          loose: c('5C 9D'),
          sets: [c('3S 4S 5S'), c('10H 10H 10H'), c('2H 3H 7C'), c('QH KH AH'), c('6D 7D 8D')],
        },
      ],
      0,
      J,
    );
    expect(results[0]).toMatchObject({ value: 10, marriages: 1 });
    // Cards are re-arranged automatically before counting (confirmed 2026-10-27).
    // Mom (saw joker): K♦ 7♣ 6♥ becomes a joker sequence; only 9♣ is left → 9 → 1 point. Value 6♥ = 2.
    expect(results[1]).toMatchObject({ value: 2, unusedSum: 9, unused: 1 });
    expect(results[1]!.loose.map((x) => x.rank + x.suit)).toEqual(['9C']);
    // Dad (no joker, so no wildcards): 9♦ extends 6♦ 7♦ 8♦. Left: 5♣ 2♥ 3♥ 7♣ (joker, removed)
    // = 5 + 2 + 3 = 10 → 1 point (half down).
    expect(results[2]).toMatchObject({ value: 0, unusedSum: 10, unused: 1 });
    expect(payments).toEqual([
      { player: 1, toDeclarer: 1 + 10 - 2 },
      { player: 2, toDeclarer: 1 + 10 - 0 },
    ]);
  });
});
