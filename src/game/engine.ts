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
  MAX_PLAYERS,
  meetsMinimum,
  MIN_PLAYERS,
  scoreRound,
  shuffle,
} from '../rules';
import type {
  ClientMessage,
  LastAction,
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
  if (!cleanName) fail('Please enter your name');
  if (state.phase === 'playing') fail('A round is being played. You can join when it ends.');
  if (state.players.length >= MAX_PLAYERS) fail(`The table is full (${MAX_PLAYERS} players)`);
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
  };
  state.result = null;
  state.phase = 'playing';
}

function leave(state: TableState, playerId: string): void {
  if (state.phase === 'playing') fail("You can't leave in the middle of a round");
  state.players = state.players.filter((p) => p.id !== playerId);
  if (state.hostId === playerId) state.hostId = state.players[0]?.id ?? null;
}

function abandonRound(state: TableState, playerId: string): void {
  requireHost(state, playerId);
  if (state.phase !== 'playing' || !state.round) fail('No round is being played');
  state.nextDealer = state.round.dealer; // nobody declared, so the same dealer deals again
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

/** Turn actions (draw, discard, declare) wait while a show is being checked or the joker picked. */
function requireNotWaiting(state: TableState, round: RoundState): void {
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
    round.lastAction = { by: playerId, kind: 'drewStock', reshuffled };
  } else if (from === 'discard') {
    const card = round.discard.pop();
    if (!card) fail('The discard pile is empty');
    hand.loose.push(card);
    round.lastAction = { by: playerId, kind: 'drewDiscard', card };
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
  round.lastAction = { by: playerId, kind: 'discarded', card };
  round.stage = 'draw';
  round.turn = (round.turn + 1) % round.seats.length;
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
  round.lastAction = { by: playerId, kind: 'showed' };
}

function ack(state: TableState, playerId: string): void {
  const round = requireRound(state);
  requireHand(round, playerId);
  const pending = round.show;
  if (!pending) fail('Nothing to check right now');
  if (pending.by === playerId) fail('Others check your sets, not you');
  if (!pending.acks.includes(playerId)) pending.acks.push(playerId);
  const everyone = round.seats.filter((id) => id !== pending.by);
  if (!everyone.every((id) => pending.acks.includes(id))) return;
  // Everyone has checked: the first shower picks the joker, later showers simply see it.
  round.show = null;
  if (round.picked === null) {
    round.awaitingPick = pending.by;
  } else {
    round.seen.push(pending.by);
    round.lastAction = { by: pending.by, kind: 'sawJoker' };
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
  round.lastAction = { by: playerId, kind: 'sawJoker' };
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

  const picked = round.picked as Card;
  const declarerIdx = round.seats.indexOf(playerId);
  const hands: PlayerHand[] = round.seats.map((id) => {
    const h = round.hands[id] as Hand;
    return { sets: h.sets, loose: h.loose, seenJoker: round.seen.includes(id) };
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
      // Declarer: their own arrangement. Others: the automatic best arrangement that was scored.
      sets: r.sets,
      loose: r.loose,
    };
  });
  state.nextDealer = playerId;
  state.result = { roundNo: round.roundNo, declarer: playerId, joker: picked, rows };
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
  const players: PlayerView[] = state.players.map((p) => {
    const hand = round?.hands[p.id];
    return {
      id: p.id,
      name: p.name,
      isHost: p.id === state.hostId,
      connected: connected.has(p.id),
      inRound: !!hand,
      seen: !!round?.seen.includes(p.id),
      shown: !!round?.shown.includes(p.id),
      sets: hand ? structuredClone(hand.sets) : [],
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
      discardCount: round.discard.length,
      hand: mine ? structuredClone(mine) : null,
      joker: playerId && round.seen.includes(playerId) ? round.picked : null,
      jokerPicked: round.picked !== null,
      show: pending
        ? {
            by: pending.by,
            sets: structuredClone(pending.sets),
            acks: [...pending.acks],
            waitingFor: round.seats.filter((id) => id !== pending.by && !pending.acks.includes(id)),
          }
        : null,
      awaitingPick: round.awaitingPick,
      lastAction: round.lastAction,
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
