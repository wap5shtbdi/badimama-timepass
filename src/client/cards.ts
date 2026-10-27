// How cards look and are named on screen.

import { type Card, isJoker, rankLabel, type Suit, valueRole } from '../rules';

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };
const SUIT_NAME: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAME: Record<number, string> = { 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' };

/** Four-colour deck by default (SPEC 8): ♦ blue, ♣ green. Classic: red/black. */
export function suitColor(suit: Suit, fourColor: boolean): string {
  if (suit === 'S') return 'var(--suit-black)';
  if (suit === 'H') return 'var(--suit-red)';
  if (suit === 'D') return fourColor ? 'var(--suit-blue)' : 'var(--suit-red)';
  return fourColor ? 'var(--suit-green)' : 'var(--suit-black)';
}

/** Short text, e.g. "10♥". */
export function cardText(card: Pick<Card, 'rank' | 'suit'>): string {
  return rankLabel(card.rank) + SUIT_SYMBOL[card.suit];
}

export type JokerMark = 'value' | 'joker' | null;

/** Gold dot for value cards, gold ring for other jokers; only once you've seen the joker. */
export function jokerMark(card: Card, joker: Card | null): JokerMark {
  if (!joker) return null;
  if (valueRole(card, joker)) return 'value';
  return isJoker(card, joker) ? 'joker' : null;
}

/** For screen readers, e.g. "Queen of spades, joker". */
export function cardLabel(card: Card, joker: Card | null): string {
  const mark = jokerMark(card, joker);
  const name = `${RANK_NAME[card.rank] ?? card.rank} of ${SUIT_NAME[card.suit]}`;
  return mark === 'value' ? `${name}, value card` : mark === 'joker' ? `${name}, joker` : name;
}
