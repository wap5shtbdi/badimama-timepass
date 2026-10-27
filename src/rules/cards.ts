// Cards, decks, dealing and joker/value-card rules for Marriage (21-card rummy).
// See SPEC.md sections 1 and 3.

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

/** 1 = Ace, 11 = Jack, 12 = Queen, 13 = King. */
export type Rank = number;

export interface Card {
  /** Unique within the 156-card shoe, e.g. "2-10H" (deck 2, ten of hearts). */
  id: string;
  rank: Rank;
  suit: Suit;
}

const RANK_LABELS: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank] ?? String(rank);
}

/** Short key without the deck number, e.g. "10H", "AS". Identical cards share a key. */
export function cardKey(card: Pick<Card, 'rank' | 'suit'>): string {
  return rankLabel(card.rank) + card.suit;
}

/** Parse a key like "10H" or "AS". The id defaults to the key (fine for tests). */
export function parseCard(key: string, id: string = key): Card {
  const suit = key.slice(-1) as Suit;
  const r = key.slice(0, -1);
  const byLabel: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };
  const rank = byLabel[r] ?? Number(r);
  if (!SUITS.includes(suit) || !Number.isInteger(rank) || rank < 1 || rank > 13) {
    throw new Error(`Bad card key: ${key}`);
  }
  return { id, rank, suit };
}

/** Parse several keys, giving each a unique id (handles duplicates like "QS QS"). */
export function parseCards(keys: string): Card[] {
  return keys
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((k, i) => parseCard(k, `${k}#${i}`));
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

// ---------- Deck and dealing ----------

export const DECKS = 3;
export const HAND_SIZE = 21;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

export function makeShoe(): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < DECKS; d++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ id: `${d}-${cardKey({ rank, suit })}`, rank, suit });
      }
    }
  }
  return cards;
}

/** Fisher–Yates shuffle. `random` must return [0, 1). Returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

export interface Deal {
  hands: Card[][];
  /** Face-down stock; the end of the array is the top. */
  stock: Card[];
  /** Face-up discard pile; the end of the array is the top. */
  discard: Card[];
}

/** Shuffle 3 decks, deal 21 cards to each player, turn one card up to start the discard pile. */
export function deal(players: number, random: () => number): Deal {
  if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) {
    throw new Error(`Marriage needs ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${players}`);
  }
  const shoe = shuffle(makeShoe(), random);
  const hands: Card[][] = Array.from({ length: players }, () => []);
  for (let round = 0; round < HAND_SIZE; round++) {
    for (let p = 0; p < players; p++) {
      (hands[p] as Card[]).push(shoe.pop() as Card);
    }
  }
  const discard = [shoe.pop() as Card];
  return { hands, stock: shoe, discard };
}

// ---------- Joker and value cards ----------
// The first player to show 3 sets picks a card from the stock; it stays out of play.
// Example: picked 7♥ → jokers (wildcards) = every 7 + 6♥ + 8♥; value cards = 6♥, 7♥, 8♥.

export function rankBelow(rank: Rank): Rank {
  return rank === 1 ? 13 : rank - 1;
}

export function rankAbove(rank: Rank): Rank {
  return rank === 13 ? 1 : rank + 1;
}

export type ValueRole = 'low' | 'tiplu' | 'high';

/** Which value card this is (if any) for the picked joker card. */
export function valueRole(card: Card, picked: Card): ValueRole | null {
  if (card.suit !== picked.suit) return null;
  if (card.rank === picked.rank) return 'tiplu';
  if (card.rank === rankBelow(picked.rank)) return 'low';
  if (card.rank === rankAbove(picked.rank)) return 'high';
  return null;
}

/** Wildcard? All cards of the picked rank (any suit) plus the two same-suit neighbours. */
export function isJoker(card: Card, picked: Card): boolean {
  return card.rank === picked.rank || valueRole(card, picked) !== null;
}
