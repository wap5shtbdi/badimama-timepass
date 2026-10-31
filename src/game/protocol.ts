// Messages between the screens (client) and the table server.
// Shared by both sides, so it must stay free of Cloudflare and browser APIs.

import type { Card } from '../rules';

// ---------- Client → server ----------

export type ClientMessage =
  /** First message on every connection. `token` is a secret the device keeps (localStorage). */
  | { type: 'hello'; token: string; name: string }
  /** Host only: start the first round (lobby) or the next round (after a result). */
  | { type: 'start' }
  /** Leave the table. Only allowed in the lobby or between rounds. */
  | { type: 'leave' }
  /** Host only: stop the current round without scoring (escape hatch if someone can't continue). */
  | { type: 'abandonRound' }
  /** Rearrange your own cards. Must contain exactly the cards you hold, by id. */
  | { type: 'arrange'; sets: string[][]; loose: string[] }
  | { type: 'draw'; from: 'stock' | 'discard' }
  | { type: 'discard'; cardId: string }
  /** Show 3 pure sets to see the joker. `setIndexes` picks which of your sets (default: the first 3 pure ones). */
  | { type: 'show'; setIndexes?: number[] }
  /** Before play: show your A♠ / 2♣ (show: true) or skip (show: false). Everyone answers once. */
  | { type: 'opening'; show: boolean }
  /**
   * Pack or declare with pairs (identical cards). First turn, before drawing: 5 to pack, 6 to declare.
   * Once everyone has had a turn, after drawing: 6 / 7, putting `discardId` down.
   */
  | { type: 'pairs'; action: 'pack' | 'declare'; discardId?: string }
  /**
   * Pack on your turn once play has started: out of the round, pays 5 card points + value difference.
   * After drawing, `discardId` is the card you put down.
   */
  | { type: 'pack'; discardId?: string }
  /** "OK, I've seen them" for the pending show. */
  | { type: 'ack' }
  /** First shower picks the joker: index into the face-down stock spread (0 … stockCount-1). */
  | { type: 'pickJoker'; index: number }
  /** Declare. With 22 cards, `discardId` is the card you put down to finish. */
  | { type: 'declare'; discardId?: string };

// ---------- Server → client ----------

export type ServerMessage =
  | { type: 'state'; view: TableView }
  | { type: 'error'; message: string };

export type Phase = 'lobby' | 'playing' | 'roundOver';
export type Stage = 'draw' | 'discard';

export interface PlayerView {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  /** In the current round (players who join between rounds wait for the next deal). */
  inRound: boolean;
  /** Has seen the joker this round. */
  seen: boolean;
  /** Has gone through a show this round (pending or done). */
  shown: boolean;
  /** Out of this round: 'pairs' (card points 0) or 'any' (5 card points). Null if still playing. */
  packed: 'pairs' | 'any' | null;
  /**
   * Sets you're allowed to see (SPEC 8: "tap a player's name"). Loose cards never are.
   * Before you've seen the joker: only their pure sequences and trails (others would reveal it).
   */
  sets: Card[][];
  /** Their sets you can't see yet because you haven't seen the joker. */
  hiddenSets: number;
  cardCount: number;
  /** Running total across rounds (sum of settlements). */
  total: number;
}

export interface ShowView {
  /** sets: 3 pure sets to see the joker; pack / pairs: pairs shown to pack / to declare. */
  kind: 'sets' | 'pack' | 'pairs';
  by: string;
  sets: Card[][];
  acks: string[];
  waitingFor: string[];
}

export interface RoundView {
  roundNo: number;
  dealer: string;
  turn: string;
  stage: Stage;
  stockCount: number;
  discardTop: Card | null;
  /** The last few discards, oldest first, top card last (drawn as a messy pile). */
  discardRecent: Card[];
  discardCount: number;
  /** Your own cards. Null if you're not in this round. */
  hand: { sets: Card[][]; loose: Card[] } | null;
  /** The picked joker card, only if YOU have seen it. */
  joker: Card | null;
  jokerPicked: boolean;
  /** Who picked the joker (public: everyone saw them show first). */
  pickedBy: string | null;
  show: ShowView | null;
  /** Player who must pick the joker now (everyone acknowledged their first show). */
  awaitingPick: string | null;
  /** The joker pick ends the round (declaring with pairs, or everyone else packed). */
  pickThenDeclare: boolean;
  /** Your chance to pack / declare with pairs right now (your turn), or null. */
  pairsWindow: { pack: number | null; declare: number | null; afterDraw: boolean } | null;
  /** Before play: who still has to show their A♠ / 2♣ or skip. Null once play has started. */
  opening: { waitingFor: string[] } | null;
  /** A♠ / 2♣ shown this round (public). */
  openingShows: OpeningShow[];
  lastAction: LastAction | null;
  /** Recent actions this round, oldest first (up to 12). */
  events: LastAction[];
}

export type LastAction =
  /** `reshuffled`: the stock was empty, so the discard pile (minus its top card) was shuffled into a new stock. */
  | { by: string; kind: 'drewStock'; reshuffled: boolean }
  | { by: string; kind: 'drewDiscard'; card: Card }
  | { by: string; kind: 'discarded'; card: Card }
  | { by: string; kind: 'showed' }
  | { by: string; kind: 'openingShow'; cards: Card[]; points: number }
  | { by: string; kind: 'showedPairs'; pairs: number; purpose: 'pack' | 'declare' }
  | { by: string; kind: 'packed'; how: 'pairs' | 'any' }
  | { by: string; kind: 'sawJoker' };

/** A♠ / 2♣ shown before play: every other player paid `points` to `by` straight away. */
export interface OpeningShow {
  by: string;
  cards: Card[];
  points: number;
}

export interface ResultRow {
  player: string;
  /** Name at the time of the round (kept even if the player leaves afterwards). */
  name: string;
  seen: boolean;
  value: number;
  marriages: number;
  /** Sum of unused card values (jokers removed). 0 for the declarer. */
  unusedSum: number;
  /** Unused-card points (sum ÷ 10, half down, capped at 10). 0 for the declarer. */
  unused: number;
  /** What this player pays the declarer (negative: the declarer pays them). 0 for the declarer. */
  pays: number;
  /** This round's net for this player from the settlement. */
  net: number;
  /** Net from A♠ / 2♣ shown before play (already paid when shown; not part of `net`). */
  openingNet: number;
  /** Packed this round: 'pairs' (card points 0) or 'any' (5), else null. */
  packed: 'pairs' | 'any' | null;
  /** Full hand, revealed at the end of the round. For everyone but the declarer, arranged automatically for scoring. */
  sets: Card[][];
  loose: Card[];
}

export interface RoundResult {
  roundNo: number;
  declarer: string;
  joker: Card;
  /** How the declarer won: 3+ sets as usual, with pairs, or everyone else packed. */
  how: 'sets' | 'pairs' | 'packed';
  rows: ResultRow[];
  openingShows: OpeningShow[];
}

export interface TableView {
  code: string;
  rev: number;
  phase: Phase;
  /** Your public player id, null until `hello` is accepted. */
  you: string | null;
  hostId: string | null;
  players: PlayerView[];
  round: RoundView | null;
  /** Last round's result (shown on the result screen). */
  result: RoundResult | null;
}
