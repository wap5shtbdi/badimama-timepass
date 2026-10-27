import { describe, expect, it } from 'vitest';
import {
  addToSet,
  arrangeMessage,
  moveBefore,
  newSet,
  pureSetCount,
  setLabel,
  sortGroup,
  sortLoose,
  toHand,
  unusedNow,
  type HandModel,
} from '../src/client/hand';
import { cardText, jokerMark } from '../src/client/cards';
import { parseCard, parseCards } from '../src/rules';

const J = parseCard('7H');
const keys = (h: HandModel) => ({
  sets: h.sets.map((s) => s.map((c) => c.id)),
  loose: h.loose.map((c) => c.id),
});

function hand(): HandModel {
  // ids: "4S#0" … unique per position
  const cs = parseCards('4S 5S 6S QD 2C 9H KD AS 3S');
  return { sets: [cs.slice(0, 3)], loose: cs.slice(3) };
}

describe('hand operations', () => {
  it('new set from selected cards, in rank order for one suit', () => {
    const h = newSet(hand(), ['3S#8', 'AS#7']);
    expect(keys(h).sets).toEqual([['4S#0', '5S#1', '6S#2'], ['AS#7', '3S#8']]);
    expect(keys(h).loose).toEqual(['QD#3', '2C#4', '9H#5', 'KD#6']);
  });

  it('add to a set, even when that empties another set', () => {
    let h = newSet(hand(), ['3S#8']);
    h = addToSet(h, 0, ['3S#8']); // moves the only card out of set 1
    expect(keys(h).sets).toEqual([['3S#8', '4S#0', '5S#1', '6S#2']]);
    // Mixed suits keep the order they were added in.
    h = addToSet(h, 0, ['QD#3']);
    expect(keys(h).sets[0]!.at(-1)).toBe('QD#3');
  });

  it('back to hand, and reordering', () => {
    let h = toHand(hand(), ['5S#1']);
    expect(keys(h).sets).toEqual([['4S#0', '6S#2']]);
    expect(keys(h).loose.at(-1)).toBe('5S#1');
    h = moveBefore(h, '5S#1', '6S#2');
    expect(keys(h).sets).toEqual([['4S#0', '5S#1', '6S#2']]);
    h = moveBefore(h, 'KD#6', 'QD#3');
    expect(keys(h).loose.slice(0, 2)).toEqual(['KD#6', 'QD#3']);
  });

  it('unknown ids change nothing', () => {
    const h = hand();
    expect(newSet(h, ['nope'])).toBe(h);
    expect(addToSet(h, 5, ['QD#3'])).toBe(h);
    expect(moveBefore(h, 'nope', 'QD#3')).toBe(h);
  });

  it('sort: suits alternate colour, then rank; Ace high only with a King', () => {
    const h = sortLoose({ sets: [], loose: parseCards('KD 2H AS 3C 10S') });
    expect(h.loose.map(cardText)).toEqual(['A♠︎', '10♠︎', '2♥︎', '3♣︎', 'K♦︎']);
    expect(sortGroup(parseCards('AH KH QH')).map((c) => c.rank)).toEqual([12, 13, 1]);
    expect(sortGroup(parseCards('3H AH 2H')).map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it('builds the arrange message', () => {
    expect(arrangeMessage(hand())).toEqual({ type: 'arrange', ...keys(hand()) });
  });
});

describe('labels', () => {
  const L = (k: string, joker = J as typeof J | null) => setLabel(parseCards(k), joker);
  it('names each kind of set', () => {
    expect(L('4S 5S 6S').text).toBe('Sequence');
    expect(L('6H 7H 8H')).toMatchObject({ text: 'Marriage', tone: 'gold' });
    expect(L('6H 6H 6H')).toMatchObject({ text: 'Marriage', tone: 'gold' });
    expect(L('KC KC KC').text).toBe('Trail');
    expect(L('4S 5S 7C').text).toBe('Sequence + joker');
    expect(L('JS JD JH').text).toBe('Mixed trail');
    expect(L('KC KD 7S').text).toBe('Mixed trail + joker');
    expect(L('7S 7C 8H').text).toBe('All jokers');
    expect(L('KC KD 7S').short).toBe('Trail + joker');
    expect(L('4S 5S 7C').short).toBe('Seq + joker');
    expect(L('4S').short).toBe('needs 3+');
  });

  it('explains invalid sets', () => {
    expect(L('4S 5S')).toMatchObject({ text: '2 cards · needs 3+', tone: 'bad' });
    expect(L('KC KC 7S').text).toBe('No jokers in a suited trail');
    expect(L('4S 5S 7C', null).text).toBe('Pure sets only (joker not seen)');
    expect(L('4S 9D QC').text).toBe('Not a valid set');
    // Before seeing the joker, a marriage-looking run is just a sequence.
    expect(L('6H 7H 8H', null).text).toBe('Sequence');
  });

  it('counts pure sets and unused points', () => {
    const h: HandModel = {
      sets: [parseCards('4S 5S 6S'), parseCards('KC KC KC'), parseCards('4D 5D 7C')],
      loose: parseCards('QD 9H 2C 8H'),
    };
    expect(pureSetCount(h)).toBe(2);
    // Joker 7♥: 7♣ and 8♥ are wild. Best: Q♦ 7♣ 8♥ as a joker sequence, leaving
    // 4♦ 5♦ 9♥ 2♣ = 20 → 2 points (beats 4♦ 5♦ 7♣, which leaves Q♦ 9♥ 2♣ = 21).
    expect(unusedNow(h, J)).toEqual({ sum: 20, points: 2 });
  });

  it('marks jokers only when the joker is known', () => {
    expect(jokerMark(parseCard('6H'), J)).toBe('value');
    expect(jokerMark(parseCard('7S'), J)).toBe('joker');
    expect(jokerMark(parseCard('7S'), null)).toBeNull();
    expect(jokerMark(parseCard('9S'), J)).toBeNull();
  });
});
