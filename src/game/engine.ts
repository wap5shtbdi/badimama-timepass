// Table game engine: the whole state of one table and every action on it.
// Pure TypeScript (no Cloudflare APIs) so it can be tested in Node. The Durable Object
// (src/server/table.ts) only stores this state, feeds it messages and sends out views.
//
// SPEC.md is the source of truth for the rules. Choices made here that SPEC.md does not
// cover are listed in SPEC.md section 10 ("Server decisions").

import {
  type Card,
  type PlayerHand,
  canDeclare,
  canShow,
  checkSet,
  deal,
  HAND_SIZE,
  isOpeningCard,
  MAX_PLAYERS,
  meetsMinimum,
  MIN_PLAYERS,
  openingPoints,
  PACK_POINTS,
  PAIRS,
  pairsOf,
  scoreRound,
  shuffle,
} from '../rules';
import type {
  ClientMessage,
  LastAction,
  OpeningShow,
  Phase,
  PlayerView,
  ResultRow,
  RoundResult,
  RoundView,
  Stage,
  TableView,
} from './protocol';

// ---------- State (stored as JSON in the Durable Object) ----------

export interface Player {
  /** Public id, sent to everyone. */
  id: string;
  /** Secret the player's device keeps; proves who they are when reconnecting. Never sent out. */
  token: string;
  name: string;
}

export interface Hand {
  sets: Card[][];
  loose: Card[];
}

export interface PendingShow {
  by: string;
  sets: Card[][];
  acks: string[];
  /** Missing on old saved games = 'sets'. */
  kind?: 'sets' | 'pack' | 'pairs';
}

export interface Packed {
  id: string;
  how: 'pairs' | 'any';
  /** Card points paid at the end instead of counting unused cards. */
  points: number;
}

export interface RoundState {
  roundNo: number;
  /** Players in this round, in turn order. */
  seats: string[];
  dealer: string;
  hands: Record<string, Hand>;
  /** Face-down stock; end of the array is the top. */
  stock: Card[];
  /** Discard pile; end of the array is the top. */
  discard: Card[];
  /** Index into `seats`. */
  turn: number;
  stage: Stage;
  /** The picked joker card (out of play). */
  picked: Card | null;
  pickedBy: string | null;
  /** Players who have seen the joker, in order. */
  seen: string[];
  /** Players who have started a show (pending or done). */
  shown: string[];
  show: PendingShow | null;
  awaitingPick: string | null;
  lastAction: LastAction | null;
  /** Recent actions this round, oldest first (the "This round" log). */
  events: LastAction[];
  /** Before play: players who have shown their A♠ / 2♣ or skipped. Null once play has started. */
  opening?: { decided: string[] } | null;
  /** A♠ / 2♣ shown this round; already paid into totals. */
  openingShows?: OpeningShow[];
  /** Players who have finished a turn (thrown a card) or packed. */
  played?: string[];
  /** Players out of this round. */
  packed?: Packed[];
  /** Declaring with pairs, waiting for this player to pick the joker first. */
  pairsDeclare?: string | null;
}

export interface TableState {
  v: 1;
  code: string;
  hostId: string | null;
  /** Seat order. */
  players: Player[];
  phase: Phase;
  /** Number of rounds dealt so far. */
  roundNo: number;
  round: RoundState | null;
  result: RoundResult | null;
  /** Running totals by player id. */
  totals: Record<string, number>;
  /** Who deals the next round: the last declarer (confirmed). Null before the first round. */
  nextDealer: string | null;
  /** Players who left between rounds: coming back with the same token restores their id and total. */
  departed?: Player[];
  /** Bumped on every accepted change. */
  rev: number;
}

export interface EngineEnv {
  /** Uniform in [0, 1). The server passes a crypto-backed source. */
  random: () => number;
  newId: () => string;
}

export class GameError extends Error {}

function fail(message: string): never {
  throw new GameError(message);
}

export type Outcome<T = void> = { ok: true; state: TableState; value: T } | { ok: false; error: string };

/**
 * Run `fn` on a copy of the state. On success the copy (with `rev` bumped) is returned;
 * on a GameError the original state is untouched, so a rejected move never half-applies.
 */
export function apply<T>(state: TableState, fn: (draft: TableState) => T): Outcome<T> {
  const draft = structuredClone(state);
  try {
    const value = fn(draft);
    draft.rev += 1;
    return { ok: true, state: draft, value };
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    throw e;
  }
}

export function createTable(code: string): TableState {
  return {
    v: 1,
    code,
    hostId: null,
    players: [],
    phase: 'lobby',
    roundNo: 0,
    round: null,
    result: null,
    totals: {},
    nextDealer: null,
    rev: 0,
  };
}

// ---------- Joining ----------

export const NAME_MAX = 20;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Join the table, or come back with the same token. Returns the player's public id. */
export function join(state: TableState, token: unknown, name: unknown, env: EngineEnv): string {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) fail('Bad player token');
  const existing = state.players.find((p) => p.token === token);
  const cleanName = typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '';
  if (existing) {
    if (cleanName) existing.name = cleanName;
    return existing.id;
  }
  if (state.phase === 'playing') fail('A round is being played. You can join when it ends.');
  if (state.players.length >= MAX_PLAYERS) fail(`The table is full (${MAX_PLAYERS} players)`);
  // Back after leaving: same player id, so the running total is kept (confirmed 2026-10-27).
  const back = state.departed?.find((p) => p.token === token);
  if (back) {
    state.departed = state.departed!.filter((p) => p !== back);
    if (cleanName) back.name = cleanName;
    state.players.push(back);
    state.hostId ??= back.id;
    return back.id;
  }
  if (!cleanName) fail('Please enter your name');
  const player: Player = { id: env.newId(), token, name: cleanName };
  state.players.push(player);
  state.totals[player.id] ??= 0;
  state.hostId ??= player.id;
  return player.id;
}

// ---------- Actions ----------

export function act(state: TableState, playerId: string, msg: ClientMessage, env: EngineEnv): void {
  if (!state.players.some((p) => p.id === playerId)) fail('You are not at this table');
  switch (msg.type) {
    case 'hello':
      return fail('Already joined');
    case 'start':
      return startRound(state, playerId, env);
    case 'leave':
      return leave(state, playerId);
    case 'abandonRound':
      return abandonRound(state, playerId);
    case 'arrange':
      return arrange(state, playerId, msg.sets, msg.loose);
    case 'draw':
      return draw(state, playerId, msg.from, env);
    case 'discard':
      return discard(state, playerId, msg.cardId);
    case 'show':
      return show(state, playerId, msg.setIndexes);
    case 'opening':
      return opening(state, playerId, msg.show);
    case 'pairs':
      return pairs(state, playerId, msg.action, msg.discardId);
    case 'pack':
      return packAnyTime(state, playerId, msg.discardId);
    case 'ack':
      return ack(state, playerId);
    case 'pickJoker':
      return pickJoker(state, playerId, msg.index, env);
    case 'declare':
      return declare(state, playerId, msg.discardId);
    default:
      return fail('Unknown action');
  }
}

function requireHost(state: TableState, playerId: string): void {
  if (state.hostId !== playerId) fail('Only the host can do that');
}

function startRound(state: TableState, playerId: string, env: EngineEnv): void {
  requireHost(state, playerId);
  if (state.phase === 'playing') fail('A round is already being played');
  const n = state.players.length;
  if (n < MIN_PLAYERS) fail(`Need at least ${MIN_PLAYERS} players`);
  const seats = state.players.map((p) => p.id);
  state.roundNo += 1;
  // The last declarer deals (confirmed). First round, or if they've left: the first player (host).
  // The player after the dealer plays first.
  const next = state.nextDealer;
  const dealerIdx = next && seats.includes(next) ? seats.indexOf(next) : 0;
  const dealt = deal(n, env.random);
  const hands: Record<string, Hand> = {};
  seats.forEach((id, i) => {
    hands[id] = { sets: [], loose: dealt.hands[i] as Card[] };
  });
  state.round = {
    roundNo: state.roundNo,
    seats,
    dealer: seats[dealerIdx] as string,
    hands,
    stock: dealt.stock,
    discard: dealt.discard,
    turn: (dealerIdx + 1) % n,
    stage: 'draw',
    picked: null,
    pickedBy: null,
    seen: [],
    shown: [],
    show: null,
    awaitingPick: null,
    lastAction: null,
    events: [],
    opening: { decided: [] },
    openingShows: [],
    played: [],
    packed: [],
    pairsDeclare: null,
  };
  state.result = null;
  state.phase = 'playing';
}

function leave(state: TableState, playerId: string): void {
  if (state.phase === 'playing') fail("You can't leave in the middle of a round");
  const leaving = state.players.find((p) => p.id === playerId);
  state.players = state.players.filter((p) => p.id !== playerId);
  if (leaving) (state.departed ??= []).push(leaving);
  if (state.hostId === playerId) state.hostId = state.players[0]?.id ?? null;
}

function abandonRound(state: TableState, playerId: string): void {
  requireHost(state, playerId);
  if (state.phase !== 'playing' || !state.round) fail('No round is being played');
  state.nextDealer = state.round.dealer; // nobody declared, so the same dealer deals again
  // "No scores": give back what was paid for A♠ / 2♣ shown this round.
  payOpening(state, state.round, -1);
  state.round = null;
  state.result = null;
  state.phase = 'lobby';
}

// ---------- Round helpers ----------

function requireRound(state: TableState): RoundState {
  if (state.phase !== 'playing' || !state.round) fail('No round is being played');
  return state.round;
}

function requireHand(round: RoundState, playerId: string): Hand {
  const hand = round.hands[playerId];
  if (!hand) fail("You're not playing this round");
  return hand;
}

function nameOf(state: TableState, id: string): string {
  return state.players.find((p) => p.id === id)?.name ?? 'Someone';
}

export const EVENTS_MAX = 12;
/** Discards shown on the table: the top card plus 4 earlier throws (public: everyone saw them). */
export const DISCARD_SHOWN = 5;

function record(round: RoundState, action: LastAction): void {
  round.lastAction = action;
  round.events ??= [];
  round.events.push(action);
  if (round.events.length > EVENTS_MAX) round.events.splice(0, round.events.length - EVENTS_MAX);
}

/** Turn actions (draw, discard, declare) wait for the A♠ / 2♣ showing, a show check, or the joker pick. */
function requireNotWaiting(state: TableState, round: RoundState): void {
  if (round.opening) {
    const left = round.seats.filter((id) => !round.opening!.decided.includes(id)).map((id) => nameOf(state, id));
    fail(`Waiting for ${left.join(', ')} to show A♠ / 2♣ or skip`);
  }
  if (round.show) fail('Waiting for everyone to check the shown sets');
  if (round.awaitingPick) fail(`Waiting for ${nameOf(state, round.awaitingPick)} to pick the joker`);
}

function requireTurn(state: TableState, round: RoundState, playerId: string): void {
  if (round.seats[round.turn] !== playerId) fail(`It's ${nameOf(state, round.seats[round.turn] as string)}'s turn`);
}

function handCards(hand: Hand): Card[] {
  return [...hand.sets.flat(), ...hand.loose];
}

const MIN3_MESSAGE = 'You must keep at least 3 pure sequences or trails';

/**
 * SPEC 6b "MINIMUM-3 RULE, FINAL": after seeing the joker, a player must always keep 3 natural sets.
 * A player whose show is still being checked (or who is about to pick the joker) is held to the same
 * rule, so the sets they showed can't be broken up before they see the joker.
 */
function guardMinimum(round: RoundState, playerId: string, sets: Card[][]): void {
  if (round.seen.includes(playerId)) {
    if (!meetsMinimum(sets, round.picked as Card)) fail(MIN3_MESSAGE);
  } else if (round.shown.includes(playerId)) {
    if (!canShow(sets)) fail(MIN3_MESSAGE);
  }
}

/** Remove a card from the hand (sets or loose); empty sets are dropped. */
function takeFromHand(hand: Hand, cardId: unknown): Card {
  if (typeof cardId !== 'string') fail('Bad card');
  const li = hand.loose.findIndex((c) => c.id === cardId);
  if (li >= 0) return hand.loose.splice(li, 1)[0] as Card;
  for (const set of hand.sets) {
    const si = set.findIndex((c) => c.id === cardId);
    if (si >= 0) {
      const card = set.splice(si, 1)[0] as Card;
      hand.sets = hand.sets.filter((s) => s.length > 0);
      return card;
    }
  }
  return fail("That card isn't in your hand");
}

/** If the stock is empty, shuffle the discard pile (minus its top card) into a new stock. */
function ensureStock(round: RoundState, random: () => number): boolean {
  if (round.stock.length > 0) return false;
  if (round.discard.length <= 1) fail('No cards left to draw');
  const top = round.discard.pop() as Card;
  round.stock = shuffle(round.discard, random);
  round.discard = [top];
  return true;
}

// ---------- Arranging ----------

const MAX_SETS = HAND_SIZE; // more groups than cards is never needed

function arrange(state: TableState, playerId: string, sets: unknown, loose: unknown): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  if (!Array.isArray(sets) || !Array.isArray(loose) || sets.length > MAX_SETS) fail('Bad arrangement');
  const byId = new Map(handCards(hand).map((c) => [c.id, c]));
  const used = new Set<string>();
  const pick = (id: unknown): Card => {
    if (typeof id !== 'string') fail('Bad arrangement');
    const card = byId.get(id);
    if (!card) fail("That card isn't in your hand");
    if (used.has(id)) fail('A card appears twice');
    used.add(id);
    return card;
  };
  const newSets = sets.map((s) => {
    if (!Array.isArray(s)) fail('Bad arrangement');
    return s.map(pick);
  });
  const newLoose = loose.map(pick);
  if (used.size !== byId.size) fail('Some of your cards are missing from the arrangement');
  const nonEmpty = newSets.filter((s) => s.length > 0);
  guardMinimum(round, playerId, nonEmpty);
  hand.sets = nonEmpty;
  hand.loose = newLoose;
}

// ---------- Turn: draw and discard ----------

function draw(state: TableState, playerId: string, from: unknown, env: EngineEnv): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  requireNotWaiting(state, round);
  requireTurn(state, round, playerId);
  if (round.stage !== 'draw') fail('You already drew a card. Discard one.');
  if (from === 'stock') {
    const reshuffled = ensureStock(round, env.random);
    hand.loose.push(round.stock.pop() as Card);
    record(round, { by: playerId, kind: 'drewStock', reshuffled });
  } else if (from === 'discard') {
    const card = round.discard.pop();
    if (!card) fail('The discard pile is empty');
    hand.loose.push(card);
    record(round, { by: playerId, kind: 'drewDiscard', card });
  } else {
    fail('Draw from the stock or the discard pile');
  }
  round.stage = 'discard';
}

function discard(state: TableState, playerId: string, cardId: unknown): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  requireNotWaiting(state, round);
  requireTurn(state, round, playerId);
  if (round.stage !== 'discard') fail('Draw a card first');
  const card = takeFromHand(hand, cardId);
  guardMinimum(round, playerId, hand.sets);
  round.discard.push(card);
  record(round, { by: playerId, kind: 'discarded', card });
  markPlayed(round, playerId);
  passTurn(round);
}

// ---------- Turns, packing ----------

function packedIds(round: RoundState): string[] {
  return (round.packed ?? []).map((p) => p.id);
}

function isPacked(round: RoundState, id: string): boolean {
  return packedIds(round).includes(id);
}

function markPlayed(round: RoundState, id: string): void {
  round.played ??= [];
  if (!round.played.includes(id)) round.played.push(id);
}

/** Next player who hasn't packed draws. */
function passTurn(round: RoundState): void {
  const n = round.seats.length;
  round.stage = 'draw';
  for (let step = 1; step <= n; step++) {
    const i = (round.turn + step) % n;
    if (!isPacked(round, round.seats[i] as string)) {
      round.turn = i;
      return;
    }
  }
}

function packPlayer(round: RoundState, id: string, how: Packed['how']): void {
  (round.packed ??= []).push({ id, how, points: PACK_POINTS[how] });
  markPlayed(round, id);
  record(round, { by: id, kind: 'packed', how });
  if (round.seats[round.turn] === id) passTurn(round);
}

/**
 * Pack on your own turn, any time after the round has started (confirmed 2026-10-31):
 * 5 card points + value difference. After drawing, you put one card down as you pack.
 */
function packAnyTime(state: TableState, playerId: string, discardId: unknown): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  if (isPacked(round, playerId)) fail('You have already packed');
  requireNotWaiting(state, round);
  requireTurn(state, round, playerId);
  if (round.stage === 'discard') {
    if (discardId === undefined) fail('Choose the card to put down');
    const card = takeFromHand(hand, discardId);
    round.discard.push(card);
    record(round, { by: playerId, kind: 'discarded', card });
  } else if (discardId !== undefined) {
    fail('Draw a card first');
  }
  packPlayer(round, playerId, 'any');
}

/** Pack or declare with pairs (confirmed 2026-10-31). See PAIRS in rules/pairs.ts. */
function pairs(state: TableState, playerId: string, action: unknown, discardId: unknown): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  if (action !== 'pack' && action !== 'declare') fail('Pack or declare');
  if (isPacked(round, playerId)) fail('You have already packed');
  requireNotWaiting(state, round);
  requireTurn(state, round, playerId);
  const firstTurn = !(round.played ?? []).includes(playerId) && round.stage === 'draw';
  const fullRound = round.seats.every((id) => (round.played ?? []).includes(id));
  let rule: { pack: number; declare: number };
  let keep: Card[];
  if (firstTurn) {
    if (discardId !== undefined) fail('Before drawing there is no card to put down');
    rule = PAIRS.firstTurn;
    keep = handCards(hand);
  } else if (fullRound) {
    if (round.stage !== 'discard') fail('Draw a card first: with pairs you pack or declare after drawing');
    if (discardId === undefined) fail('Choose the card to put down');
    rule = PAIRS.later;
    keep = handCards(hand).filter((c) => c.id !== discardId);
    if (keep.length === handCards(hand).length) fail("That card isn't in your hand");
  } else {
    fail('Pairs count on your first turn (before drawing), or once everyone has had a turn');
  }
  const need = action === 'pack' ? rule.pack : rule.declare;
  const found = pairsOf(keep);
  if (found.length < need) fail(`You need ${need} pairs to ${action}, you have ${found.length}`);
  if (discardId !== undefined) {
    const card = takeFromHand(hand, discardId);
    round.discard.push(card);
    record(round, { by: playerId, kind: 'discarded', card });
  }
  // Everyone checks the pairs ("OK, I've seen them"), then it takes effect (see ack).
  round.show = { by: playerId, sets: structuredClone(found), acks: [], kind: action === 'pack' ? 'pack' : 'pairs' };
  record(round, { by: playerId, kind: 'showedPairs', pairs: found.length, purpose: action });
}

// ---------- Show, acknowledge, pick the joker (SPEC 3, 8 "Show-and-acknowledge flow") ----------

function show(state: TableState, playerId: string, setIndexes: unknown): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  requireNotWaiting(state, round);
  requireTurn(state, round, playerId);
  if (round.shown.includes(playerId)) fail('You have already shown your sets');
  let chosen: Card[][];
  if (setIndexes === undefined) {
    chosen = hand.sets.filter((s) => checkSet(s, null).pure).slice(0, 3);
  } else {
    if (!Array.isArray(setIndexes) || setIndexes.length !== 3 || new Set(setIndexes).size !== 3) {
      fail('Choose 3 different sets to show');
    }
    chosen = setIndexes.map((i) => {
      if (!Number.isInteger(i)) fail('Bad set');
      const s = hand.sets[i as number];
      if (!s) fail('Bad set');
      return s;
    });
  }
  if (chosen.length < 3 || !chosen.every((s) => checkSet(s, null).pure)) {
    fail('You need 3 pure sequences or trails to show');
  }
  round.show = { by: playerId, sets: structuredClone(chosen), acks: [] };
  round.shown.push(playerId);
  record(round, { by: playerId, kind: 'showed' });
}

function ack(state: TableState, playerId: string): void {
  const round = requireRound(state);
  requireHand(round, playerId);
  const pending = round.show;
  if (!pending) fail('Nothing to check right now');
  if (pending.by === playerId) fail('Others check your sets, not you');
  if (!pending.acks.includes(playerId)) pending.acks.push(playerId);
  const everyone = round.seats.filter((id) => id !== pending.by && !isPacked(round, id));
  if (!everyone.every((id) => pending.acks.includes(id))) return;
  round.show = null;
  if (pending.kind === 'pack') {
    packPlayer(round, pending.by, 'pairs');
    return;
  }
  if (pending.kind === 'pairs') {
    // Declaring with pairs: pick the joker first if nobody has (confirmed), then the round ends.
    if (round.picked === null) {
      round.awaitingPick = pending.by;
      round.pairsDeclare = pending.by;
    } else {
      settle(state, round, pending.by, 'pairs');
    }
    return;
  }
  // Everyone has checked: the first shower picks the joker, later showers simply see it.
  if (round.picked === null) {
    round.awaitingPick = pending.by;
  } else {
    round.seen.push(pending.by);
    record(round, { by: pending.by, kind: 'sawJoker' });
  }
}

function pickJoker(state: TableState, playerId: string, index: unknown, env: EngineEnv): void {
  const round = requireRound(state);
  if (round.awaitingPick !== playerId) fail("It's not your turn to pick the joker");
  ensureStock(round, env.random);
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= round.stock.length) {
    fail('Pick one of the stock cards');
  }
  round.picked = round.stock.splice(index as number, 1)[0] as Card;
  round.pickedBy = playerId;
  round.awaitingPick = null;
  round.seen.push(playerId);
  record(round, { by: playerId, kind: 'sawJoker' });
  if (round.pairsDeclare === playerId) {
    round.pairsDeclare = null;
    settle(state, round, playerId, 'pairs');
  }
}

// ---------- Before play: show A♠ / 2♣ (confirmed 2026-10-31) ----------

function opening(state: TableState, playerId: string, showCards: unknown): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  if (!round.opening) fail('Play has started: too late to show A♠ or 2♣');
  if (round.opening.decided.includes(playerId)) fail('You have already answered');
  if (showCards === true) {
    const cards = handCards(hand).filter(isOpeningCard);
    if (cards.length === 0) fail('You have no A♠ or 2♣');
    const points = openingPoints(cards);
    const shown: OpeningShow = { by: playerId, cards: structuredClone(cards), points };
    (round.openingShows ??= []).push(shown);
    payOpening(state, { seats: round.seats, openingShows: [shown] }, 1);
    record(round, { by: playerId, kind: 'openingShow', cards: shown.cards, points });
  } else if (showCards !== false) {
    fail('Show or skip');
  }
  round.opening.decided.push(playerId);
  if (round.seats.every((id) => round.opening!.decided.includes(id))) round.opening = null;
}

/** Every other player in the round pays the shower (`sign` -1 gives it back). */
function payOpening(state: TableState, round: Pick<RoundState, 'seats' | 'openingShows'>, sign: 1 | -1): void {
  for (const s of round.openingShows ?? []) {
    for (const id of round.seats) {
      if (id === s.by) continue;
      state.totals[id] = (state.totals[id] ?? 0) - sign * s.points;
      state.totals[s.by] = (state.totals[s.by] ?? 0) + sign * s.points;
    }
  }
}

/** Net per player from A♠ / 2♣ shown this round. */
function openingNet(round: RoundState, playerId: string): number {
  let net = 0;
  for (const s of round.openingShows ?? []) {
    if (s.by === playerId) net += s.points * (round.seats.length - 1);
    else net -= s.points;
  }
  return net;
}

// ---------- Declare and settle (SPEC 5, 6) ----------

function declare(state: TableState, playerId: string, discardId: unknown): void {
  const round = requireRound(state);
  const hand = requireHand(round, playerId);
  requireNotWaiting(state, round);
  requireTurn(state, round, playerId);
  if (!round.seen.includes(playerId)) fail('You must see the joker before declaring');
  if (round.stage === 'discard') {
    if (discardId === undefined) fail('Choose the card to put down');
    round.discard.push(takeFromHand(hand, discardId));
  } else if (discardId !== undefined) {
    fail('Draw a card first');
  }
  const check = canDeclare(hand.sets, hand.loose, round.picked);
  if (!check.ok) fail(check.reason ?? "You can't declare yet");
  settle(state, round, playerId, 'sets');
}

/** End the round with `playerId` as declarer: score, pay, show the result. */
function settle(state: TableState, round: RoundState, playerId: string, how: RoundResult['how']): void {
  const picked = round.picked as Card;
  const declarerIdx = round.seats.indexOf(playerId);
  const hands: PlayerHand[] = round.seats.map((id) => {
    const h = round.hands[id] as Hand;
    const packed = (round.packed ?? []).find((p) => p.id === id);
    return { sets: h.sets, loose: h.loose, seenJoker: round.seen.includes(id), packedPoints: packed?.points };
  });
  const scored = scoreRound(hands, declarerIdx, picked);
  const rows: ResultRow[] = round.seats.map((id, i) => {
    const r = scored.results[i]!;
    const payment = scored.payments.find((p) => p.player === i);
    const net = scored.net[i] as number;
    state.totals[id] = (state.totals[id] ?? 0) + net;
    return {
      player: id,
      name: nameOf(state, id),
      seen: round.seen.includes(id),
      value: r.value,
      marriages: r.marriages,
      unusedSum: r.unusedSum,
      unused: r.unused,
      pays: payment?.toDeclarer ?? 0,
      net,
      openingNet: openingNet(round, id),
      packed: (round.packed ?? []).find((p) => p.id === id)?.how ?? null,
      // Declarer: their own arrangement. Others: the automatic best arrangement that was scored.
      sets: r.sets,
      loose: r.loose,
    };
  });
  state.nextDealer = playerId;
  state.result = {
    roundNo: round.roundNo,
    declarer: playerId,
    joker: picked,
    how,
    rows,
    openingShows: structuredClone(round.openingShows ?? []),
  };
  state.round = null;
  state.phase = 'roundOver';
}

// ---------- Per-player views (what each screen is allowed to know) ----------

/**
 * Build what one player may see. Never includes: other players' loose cards, the stock order,
 * the joker for players who haven't seen it, or any token.
 */
export function viewFor(state: TableState, playerId: string | null, connected: ReadonlySet<string>): TableView {
  const round = state.round;
  // Other players' sets can give away the joker (a set held together by wildcards shows which
  // cards are wild). Until you've seen the joker you only get their pure sequences and trails;
  // the rest are counted, not sent (bug reported 2026-10-29).
  // A player who has packed is out of the round: the joker becomes visible to them (confirmed).
  const viewerPacked = !!playerId && !!round && isPacked(round, playerId);
  const viewerSeen = (!!playerId && !!round?.seen.includes(playerId)) || viewerPacked;
  const players: PlayerView[] = state.players.map((p) => {
    const hand = round?.hands[p.id];
    const all = hand ? hand.sets : [];
    const visible = p.id === playerId || viewerSeen ? all : all.filter((s) => checkSet(s, null).pure);
    return {
      id: p.id,
      name: p.name,
      isHost: p.id === state.hostId,
      connected: connected.has(p.id),
      inRound: !!hand,
      seen: !!round?.seen.includes(p.id),
      shown: !!round?.shown.includes(p.id),
      packed: (round?.packed ?? []).find((x) => x.id === p.id)?.how ?? null,
      sets: structuredClone(visible),
      hiddenSets: all.length - visible.length,
      cardCount: hand ? hand.sets.flat().length + hand.loose.length : 0,
      total: state.totals[p.id] ?? 0,
    };
  });

  let roundView: RoundView | null = null;
  if (round) {
    const mine = playerId ? round.hands[playerId] : undefined;
    const pending = round.show;
    roundView = {
      roundNo: round.roundNo,
      dealer: round.dealer,
      turn: round.seats[round.turn] as string,
      stage: round.stage,
      stockCount: round.stock.length,
      discardTop: round.discard[round.discard.length - 1] ?? null,
      discardRecent: round.discard.slice(-DISCARD_SHOWN),
      discardCount: round.discard.length,
      hand: mine ? structuredClone(mine) : null,
      joker: viewerSeen ? round.picked : null,
      jokerPicked: round.picked !== null,
      pickedBy: round.pickedBy,
      show: pending
        ? {
            kind: pending.kind ?? 'sets',
            by: pending.by,
            sets: structuredClone(pending.sets),
            acks: [...pending.acks],
            waitingFor: round.seats.filter((id) => id !== pending.by && !pending.acks.includes(id) && !isPacked(round, id)),
          }
        : null,
      awaitingPick: round.awaitingPick,
      pairsWindow: pairsWindowFor(round, playerId),
      opening: round.opening
        ? { waitingFor: round.seats.filter((id) => !round.opening!.decided.includes(id)) }
        : null,
      openingShows: structuredClone(round.openingShows ?? []),
      lastAction: round.lastAction,
      events: [...(round.events ?? [])],
    };
  }

  return {
    code: state.code,
    rev: state.rev,
    phase: state.phase,
    you: playerId,
    hostId: state.hostId,
    players,
    round: roundView,
    result: state.phase === 'roundOver' ? state.result : null,
  };
}

function pairsWindowFor(round: RoundState, playerId: string | null): RoundView['pairsWindow'] {
  if (!playerId || round.seats[round.turn] !== playerId || isPacked(round, playerId)) return null;
  if (round.opening || round.show || round.awaitingPick) return null;
  const played = round.played ?? [];
  if (!played.includes(playerId) && round.stage === 'draw') return { ...PAIRS.firstTurn, afterDraw: false };
  if (round.seats.every((id) => played.includes(id))) return { ...PAIRS.later, afterDraw: true };
  return null;
}

// ---------- Parsing incoming messages ----------

const TYPES = new Set([
  'hello',
  'start',
  'leave',
  'abandonRound',
  'arrange',
  'draw',
  'discard',
  'show',
  'opening',
  'pairs',
  'pack',
  'ack',
  'pickJoker',
  'declare',
]);

/** Parse a raw WebSocket message. Field contents are validated by each action. */
export function parseMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const type = (data as { type?: unknown }).type;
  if (typeof type !== 'string' || !TYPES.has(type)) return null;
  return data as ClientMessage;
}
