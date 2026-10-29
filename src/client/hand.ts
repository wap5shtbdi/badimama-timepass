// Arranging your own cards: pure functions, no React, so they're unit-tested (test/hand.test.ts).
// The server re-checks every arrangement; these only build the message and the screen labels.

import {
  bestArrangement,
  type Card,
  checkSet,
  isJoker,
  type SetCheck,
  unusedPoints,
  valueRole,
} from '../rules';

export interface HandModel {
  sets: Card[][];
  loose: Card[];
}

const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 } as const; // alternates colours

/** Remove cards by id, keeping empty sets in place (so set indexes stay valid). */
function pull(hand: HandModel, ids: string[]): { sets: Card[][]; loose: Card[]; taken: Card[] } {
  const want = new Set(ids);
  const found = new Map<string, Card>();
  const keep = (c: Card) => {
    if (!want.has(c.id)) return true;
    found.set(c.id, c);
    return false;
  };
  const sets = hand.sets.map((s) => s.filter(keep));
  const loose = hand.loose.filter(keep);
  const taken = ids.map((id) => found.get(id)).filter((c): c is Card => !!c);
  return { sets, loose, taken };
}

const clean = (sets: Card[][]) => sets.filter((s) => s.length > 0);

/** Same-suit groups are shown in rank order (Ace high when there's a King and no 2). */
export function sortGroup(cards: Card[]): Card[] {
  const first = cards[0];
  if (!first || !cards.every((c) => c.suit === first.suit)) return cards;
  const aceHigh = cards.some((c) => c.rank === 13) && !cards.some((c) => c.rank === 2);
  const v = (c: Card) => (c.rank === 1 && aceHigh ? 14 : c.rank);
  return cards.slice().sort((a, b) => v(a) - v(b));
}

/** Start a new set from the selected cards (in the order tapped). */
export function newSet(hand: HandModel, ids: string[]): HandModel {
  const { sets, loose, taken } = pull(hand, ids);
  if (taken.length === 0) return hand;
  return { sets: [...clean(sets), sortGroup(taken)], loose };
}

/** Add the selected cards to set `index`. */
export function addToSet(hand: HandModel, index: number, ids: string[]): HandModel {
  const { sets, loose, taken } = pull(hand, ids);
  if (taken.length === 0 || !sets[index]) return hand;
  sets[index] = sortGroup([...(sets[index] as Card[]), ...taken]);
  return { sets: clean(sets), loose };
}

/** Put the selected cards back in the hand (at the end). */
export function toHand(hand: HandModel, ids: string[]): HandModel {
  const { sets, loose, taken } = pull(hand, ids);
  return { sets: clean(sets), loose: [...loose, ...taken] };
}

/** Move one card just before another one (wherever that one is). */
export function moveBefore(hand: HandModel, id: string, targetId: string): HandModel {
  if (id === targetId) return hand;
  const { sets, loose, taken } = pull(hand, [id]);
  const card = taken[0];
  if (!card) return hand;
  const li = loose.findIndex((c) => c.id === targetId);
  if (li >= 0) {
    loose.splice(li, 0, card);
    return { sets: clean(sets), loose };
  }
  for (const set of sets) {
    const si = set.findIndex((c) => c.id === targetId);
    if (si >= 0) {
      set.splice(si, 0, card);
      return { sets: clean(sets), loose };
    }
  }
  return hand;
}

/** Sort the cards in hand by suit, then rank. Sets are left alone. */
export function sortLoose(hand: HandModel): HandModel {
  const loose = hand.loose
    .slice()
    .sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank);
  return { sets: hand.sets, loose };
}

/**
 * Put the jokers in hand on the left, everything else on the right (requested 2026-10-29).
 * Each side keeps its current order; jokers are grouped by rank, then suit. Sets are left alone.
 * Only usable once you've seen the joker (`joker` is the picked card).
 */
export function jokersLeft(hand: HandModel, joker: Card): HandModel {
  const jokers = hand.loose.filter((c) => isJoker(c, joker));
  const rest = hand.loose.filter((c) => !isJoker(c, joker));
  jokers.sort((a, b) => a.rank - b.rank || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
  return { sets: hand.sets, loose: [...jokers, ...rest] };
}

/** Where a dragged card was dropped (the element's data-drop value). */
export type DropTarget = `card:${string}` | `set:${number}` | 'newset' | 'hand' | 'pile';

export type DropResult = { kind: 'arrange'; hand: HandModel } | { kind: 'discard'; cardId: string } | null;

/**
 * What dropping the dragged cards `ids` on `target` does. Shared by mouse and touch drag.
 * - on a card: put them just before it (in the hand or inside that set)
 * - on a set: add them to it; on "New set": start a set; on the hand: back to the hand (at the end)
 * - on the pile: discard, only one card and only when you may discard
 */
export function dropResult(hand: HandModel, ids: string[], target: string | null, canDiscard: boolean): DropResult {
  if (!target || ids.length === 0) return null;
  if (target.startsWith('card:')) {
    const before = target.slice(5);
    if (ids.includes(before)) return null;
    // Onto a card in a set, from outside that set: join the set in order (8♦ onto 9♦ 10♦ J♦ goes
    // first). Rearranging cards already in that set, or in the hand: exactly where dropped.
    const setIndex = hand.sets.findIndex((s) => s.some((c) => c.id === before));
    if (setIndex >= 0 && ids.some((id) => !(hand.sets[setIndex] as Card[]).some((c) => c.id === id))) {
      return { kind: 'arrange', hand: addToSet(hand, setIndex, ids) };
    }
    let next = hand;
    for (const id of ids) next = moveBefore(next, id, before);
    return next === hand ? null : { kind: 'arrange', hand: next };
  }
  if (target.startsWith('set:')) {
    const i = Number(target.slice(4));
    if (!Number.isInteger(i) || !hand.sets[i]) return null;
    return { kind: 'arrange', hand: addToSet(hand, i, ids) };
  }
  if (target === 'newset') return { kind: 'arrange', hand: newSet(hand, ids) };
  if (target === 'hand') return { kind: 'arrange', hand: toHand(hand, ids) };
  if (target === 'pile') return canDiscard && ids.length === 1 ? { kind: 'discard', cardId: ids[0] as string } : null;
  return null;
}

export function arrangeMessage(hand: HandModel) {
  return {
    type: 'arrange' as const,
    sets: hand.sets.map((s) => s.map((c) => c.id)),
    loose: hand.loose.map((c) => c.id),
  };
}

export function allCards(hand: HandModel): Card[] {
  return [...hand.sets.flat(), ...hand.loose];
}

// ---------- Labels under each set (SPEC 8 "live label") ----------

export interface SetLabel {
  text: string;
  /** Fits above a 3-card set on a phone. */
  short: string;
  tone: 'ok' | 'gold' | 'bad';
  check: SetCheck;
}

const SHORT: Record<string, string> = {
  'Sequence + joker': 'Seq + joker',
  'Mixed trail + joker': 'Trail + joker',
  'No jokers in a suited trail': 'No joker here',
  'Pure sets only (joker not seen)': 'Pure only',
  'Not a valid set': 'Not valid',
};

/** `joker`: the picked card if YOU have seen it, else null (then only pure sets are valid). */
export function setLabel(cards: Card[], joker: Card | null): SetLabel {
  const l = describe(cards, joker);
  const short = cards.length < 3 && l.tone === 'bad' ? 'needs 3+' : (SHORT[l.text] ?? l.text);
  return { ...l, short };
}

function describe(cards: Card[], joker: Card | null): Omit<SetLabel, 'short'> {
  const check = checkSet(cards, joker);
  if (!check.valid) {
    if (cards.length < 3) return { text: `${cards.length} card${cards.length === 1 ? '' : 's'} · needs 3+`, tone: 'bad', check };
    if (check.reason?.startsWith('Jokers')) return { text: 'No jokers in a suited trail', tone: 'bad', check };
    if (check.reason?.startsWith('Before')) return { text: 'Pure sets only (joker not seen)', tone: 'bad', check };
    return { text: 'Not a valid set', tone: 'bad', check };
  }
  switch (check.kind) {
    case 'sequence':
      return check.isMarriage ? { text: 'Marriage', tone: 'gold', check } : { text: 'Sequence', tone: 'ok', check };
    case 'trail': {
      // 6♥ 6♥ 6♥ / 8♥ 8♥ 8♥ also score as a marriage (SPEC 4).
      const role = joker ? valueRole(cards[0] as Card, joker) : null;
      return role === 'low' || role === 'high' ? { text: 'Marriage', tone: 'gold', check } : { text: 'Trail', tone: 'ok', check };
    }
    case 'sequenceWithJoker':
      return { text: 'Sequence + joker', tone: 'ok', check };
    case 'mixedTrail':
      return { text: 'Mixed trail', tone: 'ok', check };
    case 'mixedTrailWithJoker':
      return { text: 'Mixed trail + joker', tone: 'ok', check };
    default:
      return { text: 'All jokers', tone: 'ok', check };
  }
}

/** Pure sequences / identical trails among your sets (needed to show, and kept after). */
export function pureSetCount(hand: HandModel): number {
  return hand.sets.filter((s) => checkSet(s, null).pure).length;
}

/**
 * What you'd pay in card points if someone declared now. Uses the same automatic arrangement as
 * the real scoring, so it only depends on which cards you hold. Needs the joker (to remove jokers).
 */
export function unusedNow(hand: HandModel, joker: Card): { sum: number; points: number } {
  const arranged = bestArrangement(allCards(hand), joker, true);
  return unusedPoints(arranged.loose, joker);
}
