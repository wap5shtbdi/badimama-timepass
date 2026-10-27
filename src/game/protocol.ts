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
  /** Everyone's sets are public (SPEC 8: "tap a player's name"). Loose cards never are. */
  sets: Card[][];
  cardCount: number;
  /** Running total across rounds (sum of settlements). */
  total: number;
}

export interface ShowView {
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
  discardCount: number;
  /** Your own cards. Null if you're not in this round. */
  hand: { sets: Card[][]; loose: Card[] } | null;
  /** The picked joker card, only if YOU have seen it. */
  joker: Card | null;
  jokerPicked: boolean;
  show: ShowView | null;
  /** Player who must pick the joker now (everyone acknowledged their first show). */
  awaitingPick: string | null;
  lastAction: LastAction | null;
}

export type LastAction =
  /** `reshuffled`: the stock was empty, so the discard pile (minus its top card) was shuffled into a new stock. */
  | { by: string; kind: 'drewStock'; reshuffled: boolean }
  | { by: string; kind: 'drewDiscard'; card: Card }
  | { by: string; kind: 'discarded'; card: Card }
  | { by: string; kind: 'showed' }
  | { by: string; kind: 'sawJoker' };

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
  /** This round's net for this player. */
  net: number;
  /** Full hand, revealed at the end of the round. */
  sets: Card[][];
  loose: Card[];
}

export interface RoundResult {
  roundNo: number;
  declarer: string;
  joker: Card;
  rows: ResultRow[];
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
