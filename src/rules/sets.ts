// Set validation, showing, the minimum-3 rule and declaring. See SPEC.md section 2, 3, 5, 9.

import { type Card, isJoker, sameCard, valueRole } from './cards';

export type SetKind =
  | 'sequence' // pure: same suit, consecutive, no wildcards
  | 'trail' // pure: three identical cards (same rank AND suit)
  | 'sequenceWithJoker' // same suit, consecutive, gaps filled by jokers
  | 'mixedTrail' // same rank, different suits (only after seeing the joker)
  | 'mixedTrailWithJoker'
  | 'allJokers'; // only wildcards, e.g. 6♥ 7♠ 8♥ with joker 7♥ (confirmed allowed)

export interface SetCheck {
  valid: boolean;
  kind?: SetKind;
  /** Human-readable reason when invalid. */
  reason?: string;
  /** Pure sequence or identical trail: can be used to show (see the joker). */
  pure: boolean;
  /**
   * Counts toward the "always keep 3 sets" rule after seeing the joker.
   * Always equal to `pure`: only natural sets (pure sequences, identical trails) count, even when
   * made of joker cards (6♥7♥8♥, 6♥6♥6♥). Sets that need a wildcard never count.
   */
  countsForMinimum: boolean;
  /** Exactly low + tiplu + high of the joker suit (display label only; scoring is separate). */
  isMarriage: boolean;
}

const INVALID = (reason: string): SetCheck => ({
  valid: false,
  reason,
  pure: false,
  countsForMinimum: false,
  isMarriage: false,
});

function consecutive(ranks: number[]): boolean {
  const s = ranks.slice().sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) {
    if (s[i] !== (s[i - 1] as number) + 1) return false;
  }
  return true;
}

/** Ace can be low (A-2-3) or high (Q-K-A), never both, never wrapping (K-A-2). */
function isNaturalRun(ranks: number[]): boolean {
  return consecutive(ranks) || consecutive(ranks.map((r) => (r === 1 ? 14 : r)));
}

/** Can distinct natural ranks plus `jokers` wildcards form a run of length `total`? */
function fitsWithJokers(ranks: number[], total: number): boolean {
  const tryVals = (vals: number[]): boolean => {
    const s = vals.slice().sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) return false;
    const lo = s[0] as number;
    const hi = s[s.length - 1] as number;
    const span = hi - lo + 1;
    // Extra jokers extend the run at either end; the run must fit within A(1)..A(14).
    return span <= total && total <= 14;
  };
  return tryVals(ranks) || tryVals(ranks.map((r) => (r === 1 ? 14 : r)));
}

function allSameSuit(cards: Card[]): boolean {
  return cards.every((c) => c.suit === (cards[0] as Card).suit);
}

function allSameRank(cards: Card[]): boolean {
  return cards.every((c) => c.rank === (cards[0] as Card).rank);
}

/**
 * Check one set.
 * @param picked the joker card, or null if this player has NOT seen the joker yet
 *   (then there are no wildcards and only pure sequences / identical trails are valid).
 */
export function checkSet(cards: Card[], picked: Card | null): SetCheck {
  if (cards.length < 3) return INVALID('A set needs at least 3 cards');

  const first = cards[0] as Card;
  const identical = cards.every((c) => sameCard(c, first));
  const marriage =
    picked !== null &&
    cards.length === 3 &&
    (['low', 'tiplu', 'high'] as const).every((role) => cards.some((c) => valueRole(c, picked) === role));

  // 1. Natural sets (no wildcard needed).
  if (identical) {
    if (cards.length !== 3) return INVALID('A trail is exactly 3 identical cards');
    return { valid: true, kind: 'trail', pure: true, countsForMinimum: true, isMarriage: false };
  }
  if (allSameSuit(cards) && isNaturalRun(cards.map((c) => c.rank))) {
    return { valid: true, kind: 'sequence', pure: true, countsForMinimum: true, isMarriage: marriage };
  }

  if (picked === null) {
    return INVALID('Before seeing the joker, only pure sequences and trails are allowed');
  }

  if (allSameRank(cards)) {
    // Same rank, different suits: an off-suit trail. Valid, but never counts toward the minimum 3.
    return { valid: true, kind: 'mixedTrail', pure: false, countsForMinimum: false, isMarriage: false };
  }

  // 2. Sets that rely on wildcards.
  const naturals = cards.filter((c) => !isJoker(c, picked));
  const jokers = cards.length - naturals.length;
  if (jokers === 0) return INVALID('Not a valid set');
  if (naturals.length === 0) {
    // Only wildcards (confirmed allowed). Does NOT count toward the minimum 3 (confirmed).
    return { valid: true, kind: 'allJokers', pure: false, countsForMinimum: false, isMarriage: false };
  }

  if (allSameRank(naturals)) {
    const n0 = naturals[0] as Card;
    if (naturals.every((c) => sameCard(c, n0))) {
      return INVALID("Jokers can't complete a suited trail");
    }
    return { valid: true, kind: 'mixedTrailWithJoker', pure: false, countsForMinimum: false, isMarriage: false };
  }

  if (allSameSuit(naturals) && fitsWithJokers(naturals.map((c) => c.rank), cards.length)) {
    // Valid, but does NOT count toward the minimum 3: those sets may not rely on jokers (confirmed).
    return { valid: true, kind: 'sequenceWithJoker', pure: false, countsForMinimum: false, isMarriage: false };
  }

  return INVALID('Not a valid set');
}

/** May this player show (to see the joker)? Needs 3 pure sequences or identical trails. */
export function canShow(sets: Card[][]): boolean {
  return sets.filter((s) => checkSet(s, null).pure).length >= 3;
}

/** Number of sets that count toward the "always keep 3" rule. */
export function countingSets(sets: Card[][], picked: Card): number {
  return sets.filter((s) => checkSet(s, picked).countsForMinimum).length;
}

/** After seeing the joker, a player must always keep at least 3 counting sets. */
export function meetsMinimum(sets: Card[][], picked: Card): boolean {
  return countingSets(sets, picked) >= 3;
}

export interface DeclareCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Can this player declare? They must have seen the joker, have no loose cards,
 * every set valid, and still meet the minimum-3 rule. Call after discarding (21 cards).
 */
export function canDeclare(sets: Card[][], loose: Card[], picked: Card | null): DeclareCheck {
  if (picked === null) return { ok: false, reason: 'You must see the joker before declaring' };
  if (loose.length > 0) return { ok: false, reason: 'All cards must be in sets' };
  for (const s of sets) {
    const c = checkSet(s, picked);
    if (!c.valid) return { ok: false, reason: c.reason ?? 'Invalid set' };
  }
  if (!meetsMinimum(sets, picked)) return { ok: false, reason: 'You need at least 3 counting sets' };
  return { ok: true };
}
