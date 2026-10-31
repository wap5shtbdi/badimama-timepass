import { describe, expect, it } from 'vitest';
import {
  act,
  apply,
  createTable,
  type EngineEnv,
  type Hand,
  join,
  parseMessage,
  type TableState,
  viewFor,
} from '../src/game/engine';
import type { ClientMessage } from '../src/game/protocol';
import { type Card, checkSet, countPairs, isOpeningCard, openingPoints, parseCard } from '../src/rules';

// ---------- Helpers ----------

/** Deterministic random (mulberry32) so deals are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEnv(seed = 1): EngineEnv {
  let n = 0;
  return { random: seeded(seed), newId: () => `p${n++}` };
}

const token = (i: number) => `token-for-player-${i}-xxxxxxxx`;
const NAMES = ['Vikram', 'Mom', 'Dad', 'Sister', 'Jiju', 'Extra'];

/** Cards with ids unique to `tag`, e.g. cards('a', '7H 7H') → ids a0-7H, a1-7H. */
function cards(tag: string, keys: string): Card[] {
  return keys
    .trim()
    .split(/\s+/)
    .map((k, i) => parseCard(k, `${tag}${i}-${k}`));
}

class Game {
  state: TableState = createTable('TEST');
  env: EngineEnv;
  ids: string[] = [];

  constructor(players: number, seed = 1) {
    this.env = makeEnv(seed);
    for (let i = 0; i < players; i++) this.ids.push(this.join(i));
  }

  join(i: number, name = NAMES[i]): string {
    const r = apply(this.state, (d) => join(d, token(i), name, this.env));
    if (!r.ok) throw new Error(r.error);
    this.state = r.state;
    return r.value;
  }

  /** Apply an action; returns the error message, or null on success. */
  /** Tests not about the A♠ / 2♣ opening skip it: everyone answers "don't show" after the deal. */
  autoSkipOpening = true;

  try(player: number, msg: ClientMessage): string | null {
    const r = apply(this.state, (d) => act(d, this.ids[player]!, msg, this.env));
    if (!r.ok) return r.error;
    this.state = r.state;
    if (msg.type === 'start' && this.autoSkipOpening) {
      for (const id of this.state.round!.seats) {
        const s = apply(this.state, (d) => act(d, id, { type: 'opening', show: false }, this.env));
        if (!s.ok) throw new Error(s.error);
        this.state = s.state;
      }
    }
    return null;
  }

  do(player: number, msg: ClientMessage): void {
    const err = this.try(player, msg);
    if (err) throw new Error(`player ${player} ${msg.type}: ${err}`);
  }

  get round() {
    return this.state.round!;
  }

  hand(player: number): Hand {
    return this.round.hands[this.ids[player]!]!;
  }

  setHand(player: number, sets: Card[][], loose: Card[]): void {
    this.round.hands[this.ids[player]!] = { sets, loose };
  }

  turnPlayer(): number {
    return this.ids.indexOf(this.round.seats[this.round.turn]!);
  }

  view(player: number) {
    return viewFor(this.state, this.ids[player]!, new Set(this.ids));
  }
}

function countAllCards(s: TableState): number {
  const r = s.round!;
  const inHands = Object.values(r.hands).reduce((a, h) => a + h.sets.flat().length + h.loose.length, 0);
  return inHands + r.stock.length + r.discard.length + (r.picked ? 1 : 0);
}

/** Three pure sets plus 12 loose cards: enough to show. */
function showableHand(tag: string): { sets: Card[][]; loose: Card[] } {
  return {
    sets: [cards(tag + 'a', '4S 5S 6S'), cards(tag + 'b', '9D 10D JD'), cards(tag + 'c', 'KC KC KC')],
    loose: cards(tag + 'd', 'QS QS 2H JH 3D AC 2C 5C 9C 4H 10S 8C'),
  };
}

// ---------- Lobby ----------

describe('lobby', () => {
  it('first player is host; rejoining with the same token keeps the seat', () => {
    const g = new Game(3);
    expect(g.state.hostId).toBe(g.ids[0]);
    expect(g.state.players.map((p) => p.name)).toEqual(['Vikram', 'Mom', 'Dad']);
    const again = g.join(1, 'Mummy');
    expect(again).toBe(g.ids[1]);
    expect(g.state.players).toHaveLength(3);
    expect(g.state.players[1]!.name).toBe('Mummy');
  });

  it('rejects a 6th player, bad tokens and empty names', () => {
    const g = new Game(5);
    expect(() => g.join(5)).toThrow(/full/);
    const bad = apply(g.state, (d) => join(d, 'short', 'X', g.env));
    expect(bad.ok).toBe(false);
    const g2 = new Game(1);
    expect(() => g2.join(1, '   ')).toThrow(/name/);
  });

  it('trims and caps names', () => {
    const g = new Game(0);
    g.join(0, '  ' + 'A'.repeat(40) + '  ');
    expect(g.state.players[0]!.name).toBe('A'.repeat(20));
  });

  it('only the host can start, and needs 2 players', () => {
    const solo = new Game(1);
    expect(solo.try(0, { type: 'start' })).toMatch(/at least 2/);
    const g = new Game(3);
    expect(g.try(1, { type: 'start' })).toMatch(/host/);
    expect(g.try(0, { type: 'start' })).toBeNull();
    expect(g.state.phase).toBe('playing');
  });

  it('leaving and coming back keeps the same player and running total', () => {
    const g = new Game(3);
    g.state.totals[g.ids[1]!] = 34;
    g.state.phase = 'roundOver';
    g.do(1, { type: 'leave' });
    expect(g.state.players.map((p) => p.name)).toEqual(['Vikram', 'Dad']);
    const back = g.join(1, 'Mom');
    expect(back).toBe(g.ids[1]);
    expect(g.state.totals[back]).toBe(34);
    expect(g.view(1).players.find((p) => p.id === back)!.total).toBe(34);
    expect(g.state.departed).toEqual([]);
  });

  it('leaving passes the host role on; not allowed mid-round', () => {
    const g = new Game(3);
    g.do(0, { type: 'leave' });
    expect(g.state.players).toHaveLength(2);
    expect(g.state.hostId).toBe(g.ids[1]);
    g.do(1, { type: 'start' });
    expect(g.try(2, { type: 'leave' })).toMatch(/middle of a round/);
  });

  it('new players cannot join mid-round, but a returning player can', () => {
    const g = new Game(3);
    g.do(0, { type: 'start' });
    expect(() => g.join(3)).toThrow(/round is being played/);
    expect(g.join(2)).toBe(g.ids[2]);
  });

  it('a rejected action leaves the state untouched', () => {
    const g = new Game(3);
    const before = JSON.stringify(g.state);
    expect(g.try(1, { type: 'start' })).not.toBeNull();
    expect(JSON.stringify(g.state)).toBe(before);
  });
});

// ---------- Dealing and turns ----------

describe('dealing and turns', () => {
  it('deals 21 each, one card face up, keeps all 156 cards', () => {
    const g = new Game(4);
    g.do(0, { type: 'start' });
    for (let i = 0; i < 4; i++) expect(g.hand(i).loose).toHaveLength(21);
    expect(g.round.discard).toHaveLength(1);
    expect(g.round.stock).toHaveLength(156 - 84 - 1);
    expect(countAllCards(g.state)).toBe(156);
    // Round 1: dealer is seat 0, seat 1 plays first.
    expect(g.round.dealer).toBe(g.ids[0]);
    expect(g.turnPlayer()).toBe(1);
  });

  it('draw → 22 cards → discard → next player', () => {
    const g = new Game(3);
    g.do(0, { type: 'start' });
    expect(g.try(0, { type: 'draw', from: 'stock' })).toMatch(/Mom's turn/);
    expect(g.try(1, { type: 'discard', cardId: g.hand(1).loose[0]!.id })).toMatch(/Draw a card first/);
    const stockBefore = g.round.stock.length;
    g.do(1, { type: 'draw', from: 'stock' });
    expect(g.hand(1).loose).toHaveLength(22);
    expect(g.round.stock).toHaveLength(stockBefore - 1);
    expect(g.round.stage).toBe('discard');
    expect(g.try(1, { type: 'draw', from: 'stock' })).toMatch(/already drew/);
    expect(g.try(1, { type: 'discard', cardId: 'not-a-card' })).toMatch(/isn't in your hand/);
    const card = g.hand(1).loose[5]!;
    g.do(1, { type: 'discard', cardId: card.id });
    expect(g.hand(1).loose).toHaveLength(21);
    expect(g.round.discard.at(-1)).toEqual(card);
    expect(g.turnPlayer()).toBe(2);
    expect(g.round.lastAction).toEqual({ by: g.ids[1], kind: 'discarded', card });
    expect(g.view(0).round!.events.map((e) => e.kind)).toEqual(['drewStock', 'discarded']);
    expect(g.view(0).round!.discardRecent.at(-1)).toEqual(card);
    expect(g.view(0).round!.discardRecent).toHaveLength(2);
    expect(countAllCards(g.state)).toBe(156);
  });

  it('taking the discard puts the top card in hand', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    const top = g.round.discard.at(-1)!;
    g.do(1, { type: 'draw', from: 'discard' });
    expect(g.hand(1).loose.at(-1)).toEqual(top);
    expect(g.round.discard).toHaveLength(0);
    expect(g.round.lastAction).toEqual({ by: g.ids[1], kind: 'drewDiscard', card: top });
  });

  it('keeps only the last 12 events', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    for (let i = 0; i < 10; i++) {
      const p = g.turnPlayer();
      g.do(p, { type: 'draw', from: 'stock' });
      g.do(p, { type: 'discard', cardId: g.hand(p).loose[0]!.id });
    }
    expect(g.round.events).toHaveLength(12);
    expect(g.view(0).round!.discardRecent).toHaveLength(5);
    expect(g.round.events.at(-1)).toEqual(g.round.lastAction);
  });

  it('turn wraps around the table', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    for (const p of [1, 0, 1]) {
      expect(g.turnPlayer()).toBe(p);
      g.do(p, { type: 'draw', from: 'stock' });
      g.do(p, { type: 'discard', cardId: g.hand(p).loose[0]!.id });
    }
    expect(g.turnPlayer()).toBe(0);
  });

  it('reshuffles the discard pile (minus its top) when the stock runs out', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    const r = g.round;
    r.discard.push(...r.stock.splice(0)); // empty the stock onto the discard pile
    const top = r.discard.at(-1)!;
    const pileSize = r.discard.length;
    g.do(1, { type: 'draw', from: 'stock' });
    expect(g.round.discard).toEqual([top]);
    expect(g.round.stock).toHaveLength(pileSize - 2);
    expect(g.round.lastAction).toMatchObject({ kind: 'drewStock', reshuffled: true });
    expect(countAllCards(g.state)).toBe(156);
  });

  it('cannot draw when stock and discard are both exhausted', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    g.round.stock = [];
    expect(g.try(1, { type: 'draw', from: 'stock' })).toMatch(/No cards left/);
  });

  it('first round: the host deals; an abandoned round is dealt again by the same dealer', () => {
    const g = new Game(3);
    g.do(0, { type: 'start' });
    expect(g.round.dealer).toBe(g.ids[0]);
    g.state.nextDealer = g.ids[2]!; // as if Dad had declared last
    g.state.phase = 'roundOver';
    g.state.round = null;
    g.do(0, { type: 'start' });
    expect(g.round.dealer).toBe(g.ids[2]);
    expect(g.turnPlayer()).toBe(0); // the player after the dealer starts
    g.do(0, { type: 'abandonRound' });
    g.do(0, { type: 'start' });
    expect(g.round.dealer).toBe(g.ids[2]);
  });

  it('if the last declarer has left, the first player deals', () => {
    const g = new Game(3);
    g.state.nextDealer = 'gone';
    g.do(0, { type: 'start' });
    expect(g.round.dealer).toBe(g.ids[0]);
  });

  it('host can abandon a round; others cannot', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    expect(g.try(1, { type: 'abandonRound' })).toMatch(/host/);
    g.do(0, { type: 'abandonRound' });
    expect(g.state.phase).toBe('lobby');
    expect(g.state.round).toBeNull();
  });
});

// ---------- Arranging ----------

describe('arranging', () => {
  it('accepts any arrangement of exactly your own cards; drops empty sets', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    const ids = g.hand(0).loose.map((c) => c.id);
    g.do(0, { type: 'arrange', sets: [ids.slice(0, 3), [], ids.slice(3, 7)], loose: ids.slice(7) });
    expect(g.hand(0).sets.map((s) => s.length)).toEqual([3, 4]);
    expect(g.hand(0).loose).toHaveLength(14);
    // Can arrange out of turn too.
    expect(g.turnPlayer()).toBe(1);
  });

  it('rejects missing, duplicated or foreign cards', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    const ids = g.hand(0).loose.map((c) => c.id);
    const other = g.hand(1).loose[0]!.id;
    expect(g.try(0, { type: 'arrange', sets: [], loose: ids.slice(1) })).toMatch(/missing/);
    expect(g.try(0, { type: 'arrange', sets: [[ids[0]!]], loose: ids })).toMatch(/twice/);
    expect(g.try(0, { type: 'arrange', sets: [], loose: [...ids.slice(1), other] })).toMatch(/isn't in your hand/);
    expect(g.try(0, { type: 'arrange', sets: 'x' as never, loose: ids })).toMatch(/Bad arrangement/);
  });
});

// ---------- Show, acknowledge, pick the joker ----------

function gameWithShower(): Game {
  const g = new Game(3);
  g.do(0, { type: 'start' }); // Mom (1) plays first
  const h = showableHand('m');
  g.setHand(1, h.sets, h.loose.slice(0, 12));
  return g;
}

describe('show and acknowledge', () => {
  it('needs your turn and 3 pure sets', () => {
    const g = gameWithShower();
    expect(g.try(2, { type: 'show' })).toMatch(/Mom's turn/);
    g.setHand(2, [cards('x', '4S 5S 6S')], []);
    const noSets = new Game(2);
    noSets.do(0, { type: 'start' });
    expect(noSets.try(1, { type: 'show' })).toMatch(/3 pure/);
  });

  it('a sequence that needs a joker cannot be shown', () => {
    const g = gameWithShower();
    g.hand(1).sets[2] = cards('j', '2C 3C 5C');
    expect(g.try(1, { type: 'show' })).toMatch(/3 pure/);
  });

  it('full flow: show → everyone acks → shower picks joker → only they see it', () => {
    const g = gameWithShower();
    g.do(1, { type: 'draw', from: 'stock' });
    g.do(1, { type: 'show' });
    expect(g.round.show!.by).toBe(g.ids[1]);
    expect(g.view(0).round!.show!.waitingFor).toEqual([g.ids[0], g.ids[2]]);

    // Game waits: no turn actions while the show is being checked.
    expect(g.try(1, { type: 'discard', cardId: g.hand(1).loose[0]!.id })).toMatch(/Waiting for everyone/);
    expect(g.try(1, { type: 'ack' })).toMatch(/Others check/);
    expect(g.try(1, { type: 'show' })).toMatch(/Waiting/);

    g.do(0, { type: 'ack' });
    g.do(0, { type: 'ack' }); // double tap is harmless
    expect(g.round.show!.acks).toEqual([g.ids[0]]);
    g.do(2, { type: 'ack' });
    expect(g.round.show).toBeNull();
    expect(g.round.awaitingPick).toBe(g.ids[1]);
    expect(g.try(1, { type: 'discard', cardId: g.hand(1).loose[0]!.id })).toMatch(/pick the joker/);

    expect(g.try(0, { type: 'pickJoker', index: 0 })).toMatch(/not your turn to pick/);
    expect(g.try(1, { type: 'pickJoker', index: g.round.stock.length })).toMatch(/Pick one/);
    expect(g.try(1, { type: 'pickJoker', index: 1.5 })).toMatch(/Pick one/);
    const stockBefore = g.round.stock.length;
    const expected = g.round.stock[7]!;
    g.do(1, { type: 'pickJoker', index: 7 });
    expect(g.round.picked).toEqual(expected);
    expect(g.round.stock).toHaveLength(stockBefore - 1);
    expect(g.round.seen).toEqual([g.ids[1]]);

    expect(g.view(1).round!.joker).toEqual(expected);
    expect(g.view(0).round!.joker).toBeNull();
    expect(g.view(0).round!.jokerPicked).toBe(true);
    expect(JSON.stringify(g.view(0))).not.toContain(`"id":"${expected.id}"`);

    // Shower's turn continues: discard.
    g.do(1, { type: 'discard', cardId: g.hand(1).loose[0]!.id });
    expect(g.turnPlayer()).toBe(2);
  });

  it('later showers go through acknowledgement too, then see the joker without picking', () => {
    const g = gameWithShower();
    g.do(1, { type: 'show' });
    g.do(0, { type: 'ack' });
    g.do(2, { type: 'ack' });
    g.do(1, { type: 'pickJoker', index: 0 });
    g.do(1, { type: 'draw', from: 'stock' });
    g.do(1, { type: 'discard', cardId: g.hand(1).loose[0]!.id });

    const h = showableHand('d');
    g.setHand(2, h.sets, h.loose);
    expect(g.try(1, { type: 'show' })).toMatch(/Dad's turn/);
    g.do(2, { type: 'show' });
    expect(g.view(2).round!.joker).toBeNull();
    g.do(0, { type: 'ack' });
    g.do(1, { type: 'ack' });
    expect(g.round.awaitingPick).toBeNull();
    expect(g.round.seen).toEqual([g.ids[1], g.ids[2]]);
    expect(g.view(2).round!.joker).toEqual(g.round.picked);
    expect(g.try(2, { type: 'show' })).toMatch(/already shown/);
  });

  it('show with chosen set indexes', () => {
    const g = gameWithShower();
    g.hand(1).sets.unshift(cards('z', 'AH 2H 3H'));
    expect(g.try(1, { type: 'show', setIndexes: [0, 0, 1] })).toMatch(/3 different/);
    expect(g.try(1, { type: 'show', setIndexes: [0, 1, 9] })).toMatch(/Bad set/);
    g.do(1, { type: 'show', setIndexes: [0, 2, 3] });
    expect(g.round.show!.sets.map((s) => s[0]!.id)).toEqual([
      g.hand(1).sets[0]![0]!.id,
      g.hand(1).sets[2]![0]!.id,
      g.hand(1).sets[3]![0]!.id,
    ]);
  });
});

// ---------- Minimum-3 rule ----------

describe('minimum-3 rule (SPEC 6b)', () => {
  function seenMom(): Game {
    const g = gameWithShower();
    g.do(1, { type: 'draw', from: 'stock' });
    g.do(1, { type: 'show' });
    g.do(0, { type: 'ack' });
    g.do(2, { type: 'ack' });
    g.do(1, { type: 'pickJoker', index: 0 });
    return g;
  }

  it('a shower whose show is pending cannot break up their sets', () => {
    const g = gameWithShower();
    g.do(1, { type: 'show' });
    const h = g.hand(1);
    const all = [...h.sets.flat(), ...h.loose].map((c) => c.id);
    expect(g.try(1, { type: 'arrange', sets: [], loose: all })).toMatch(/at least 3/);
  });

  it('after seeing: arranging or discarding that leaves fewer than 3 natural sets is blocked', () => {
    const g = seenMom();
    const h = g.hand(1);
    const [s0, s1, s2] = h.sets.map((s) => s.map((c) => c.id));
    const loose = h.loose.map((c) => c.id);
    expect(g.try(1, { type: 'arrange', sets: [s0!, s1!], loose: [...s2!, ...loose] })).toMatch(/at least 3/);
    expect(g.try(1, { type: 'discard', cardId: s0![0]! })).toMatch(/at least 3/);
    // A loose card is fine.
    expect(g.try(1, { type: 'discard', cardId: loose[0]! })).toBeNull();
  });

  it('may break a set once another natural set is in place', () => {
    const g = seenMom();
    // Give Mom a 4th pure set among her loose cards, then break one of the first three.
    const extra = cards('e', '7C 8C 9C');
    g.hand(1).loose.push(...extra);
    const h = g.hand(1);
    const [s0, s1, s2] = h.sets.map((s) => s.map((c) => c.id));
    const loose = h.loose.filter((c) => !extra.includes(c)).map((c) => c.id);
    expect(
      g.try(1, { type: 'arrange', sets: [s1!, s2!, extra.map((c) => c.id)], loose: [...s0!, ...loose] }),
    ).toBeNull();
  });
});

// ---------- Declaring and settlement ----------

describe('declare and settle', () => {
  /**
   * Joker 7♥, picked by Mom. Mom (seen) has 21 cards in 7 valid sets incl. the marriage 6♥7♥8♥.
   * Dad saw the joker, Sister and Vikram didn't. Mom plays first.
   */
  function readyToDeclare(): Game {
    const g = new Game(4);
    g.do(0, { type: 'start' });
    const r = g.round;
    r.picked = parseCard('7H', 'picked-7H');
    r.pickedBy = g.ids[1]!;
    r.seen = [g.ids[1]!, g.ids[2]!];
    r.shown = [g.ids[1]!, g.ids[2]!];
    g.setHand(
      1,
      [
        cards('m1', '4S 5S 6S'),
        cards('m2', '9D 10D JD'),
        cards('m3', 'KC KC KC'),
        cards('m4', '6H 7H 8H'),
        cards('m5', 'AD 2D 3D'),
        cards('m6', '10C JC QC'),
        cards('m7', '8S 9S 10S'),
      ],
      [],
    );
    // Dad (seen): 8♥ = value 2. Auto-arranged: K♦ Q♦ 8♥ is a joker sequence → only 3♠ unused → 0 points.
    g.setHand(2, [cards('d1', 'AS 2S 3S'), cards('d2', '4D 5D 6D')], cards('d3', 'KD QD 8H 3S'));
    // Sister (not seen, no wildcards): K♥ Q♥ J♥ is a pure sequence once auto-arranged.
    // Unused 5♣ 6♣ 9♥ (7♠ is a joker, removed) = 20 → 2 points. Value 0.
    g.setHand(3, [cards('s1', '5C 6C 7S'), cards('s2', 'AC 2C 3C')], cards('s3', 'KH QH JH 9H'));
    // Vikram (not seen): 2♠ 3♦ = 5 → 0 points (half down).
    g.setHand(0, [], cards('v1', '2S 3D'));
    return g;
  }

  it('must have seen the joker', () => {
    const g = readyToDeclare();
    g.round.seen = [g.ids[2]!];
    g.do(1, { type: 'draw', from: 'stock' });
    const drawn = g.hand(1).loose[0]!;
    expect(g.try(1, { type: 'declare', discardId: drawn.id })).toMatch(/see the joker/);
  });

  it('with 22 cards the card to put down is required; with 21 there is none', () => {
    const g = readyToDeclare();
    expect(g.try(1, { type: 'declare', discardId: 'm10-4S' })).toMatch(/Draw a card first/);
    g.do(1, { type: 'draw', from: 'stock' });
    expect(g.try(1, { type: 'declare' })).toMatch(/Choose the card/);
  });

  it('rejects when cards are left over, without changing anything', () => {
    const g = readyToDeclare();
    g.do(1, { type: 'draw', from: 'stock' });
    const h = g.hand(1);
    const drawn = h.loose[0]!;
    // Pull 8♠ out of the last set: 6 full sets still meet the minimum-3 rule, so this is allowed.
    const sets = h.sets.map((s) => s.map((c) => c.id));
    const last = sets.pop()!;
    g.do(1, { type: 'arrange', sets: [...sets, last.slice(1)], loose: [last[0]!, drawn.id] });
    const before = JSON.stringify(g.state);
    expect(g.try(1, { type: 'declare', discardId: drawn.id })).toMatch(/All cards must be in sets/);
    expect(JSON.stringify(g.state)).toBe(before);
  });

  it('settles as SPEC 6: each pays card points + declarer value − own value', () => {
    const g = readyToDeclare();
    g.do(1, { type: 'draw', from: 'stock' });
    const drawn = g.hand(1).loose[0]!;
    g.do(1, { type: 'declare', discardId: drawn.id });

    expect(g.state.phase).toBe('roundOver');
    expect(g.state.round).toBeNull();
    const res = g.state.result!;
    expect(res.declarer).toBe(g.ids[1]);
    expect(res.joker).toMatchObject({ rank: 7, suit: 'H' });
    const row = (i: number) => res.rows.find((r) => r.player === g.ids[i])!;
    expect(row(1)).toMatchObject({ name: 'Mom', value: 10, marriages: 1, unused: 0, pays: 0, net: 30 });
    expect(row(2)).toMatchObject({ seen: true, value: 2, unusedSum: 3, unused: 0, pays: 8, net: -8 }); // 0 + 10 − 2
    expect(row(3)).toMatchObject({ seen: false, value: 0, unusedSum: 20, unused: 2, pays: 12, net: -12 }); // 2 + 10 − 0
    expect(row(3).loose.map((c) => c.rank + c.suit)).toEqual(['5C', '6C', '7S', '9H']);
    expect(row(0)).toMatchObject({ seen: false, unusedSum: 5, unused: 0, pays: 10, net: -10 }); // 0 + 10 − 0
    expect(row(1).sets).toHaveLength(7);

    expect(Object.values(g.state.totals).reduce((a, b) => a + b, 0)).toBe(0);
    expect(g.state.totals[g.ids[1]!]).toBe(30);
    expect(g.state.nextDealer).toBe(g.ids[1]); // Mom declared, so Mom deals next

    // Result is visible to everyone, hands revealed.
    const v = g.view(0);
    expect(v.result!.rows).toHaveLength(4);
    expect(v.round).toBeNull();
    expect(v.players.find((p) => p.id === g.ids[1])!.total).toBe(30);

    // Next round; totals carry over, result clears.
    g.do(0, { type: 'start' });
    expect(g.state.phase).toBe('playing');
    expect(g.view(0).result).toBeNull();
    expect(g.state.totals[g.ids[1]!]).toBe(30);
    expect(g.round.dealer).toBe(g.ids[1]);
    expect(g.turnPlayer()).toBe(2);
  });

  it('a non-declarer with high value points gets paid by the declarer', () => {
    const g = readyToDeclare();
    // Vikram holds 6♥ 6♥ 6♥ 8♥ 8♥ 8♥ (two marriages = 20), loose. 6s/8s♥ are jokers → unused sum 0.
    g.setHand(0, [], cards('v2', '6H 6H 6H 8H 8H 8H'));
    g.do(1, { type: 'draw', from: 'stock' });
    g.do(1, { type: 'declare', discardId: g.hand(1).loose[0]!.id });
    const vik = g.state.result!.rows.find((r) => r.player === g.ids[0])!;
    expect(vik).toMatchObject({ value: 20, unused: 0, pays: -10, net: 10 }); // 0 + 10 − 20
  });

  it('cannot declare out of turn or while a show is pending', () => {
    const g = readyToDeclare();
    expect(g.try(2, { type: 'declare' })).toMatch(/Mom's turn/);
    g.round.show = { by: g.ids[2]!, sets: [], acks: [] };
    expect(g.try(1, { type: 'declare' })).toMatch(/Waiting for everyone/);
  });

  it('can declare at the start of a turn with 21 cards already in sets', () => {
    const g = readyToDeclare();
    expect(g.try(1, { type: 'declare' })).toBeNull();
    expect(g.state.result!.declarer).toBe(g.ids[1]);
  });
});

// ---------- What each player is allowed to see ----------

describe('views', () => {
  it('never leak other players’ loose cards, the stock, or tokens', () => {
    const g = new Game(3);
    g.do(0, { type: 'start' });
    const ids = g.hand(1).loose.map((c) => c.id);
    g.do(1, { type: 'arrange', sets: [ids.slice(0, 3)], loose: ids.slice(3) });

    const v = g.view(0);
    const json = JSON.stringify(v);
    for (const c of g.hand(1).loose) expect(json).not.toContain(`"id":"${c.id}"`);
    for (const c of g.hand(2).loose) expect(json).not.toContain(`"id":"${c.id}"`);
    for (const c of g.round.stock) expect(json).not.toContain(`"id":"${c.id}"`);
    for (let i = 0; i < 3; i++) expect(json).not.toContain(token(i));

    // Own cards are there; Mom's set is public.
    expect(v.round!.hand!.loose).toHaveLength(21);
    const mom = v.players.find((p) => p.id === g.ids[1])!;
    // Three random cards aren't a pure set, so before seeing the joker it's only counted.
    const pure = checkSet(g.hand(1).sets[0]!, null).pure;
    expect(mom.sets).toHaveLength(pure ? 1 : 0);
    expect(mom.hiddenSets).toBe(pure ? 0 : 1);
    expect(mom.cardCount).toBe(21);
    expect(v.round!.discardTop).toEqual(g.round.discard.at(-1));
    expect(v.round!.stockCount).toBe(g.round.stock.length);
  });

  it('marks who is connected and who is host', () => {
    const g = new Game(3);
    const v = viewFor(g.state, g.ids[0]!, new Set([g.ids[0]!]));
    expect(v.players.map((p) => [p.isHost, p.connected])).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ]);
  });

  it('a spectator view (no player) has no hand', () => {
    const g = new Game(2);
    g.do(0, { type: 'start' });
    const v = viewFor(g.state, null, new Set());
    expect(v.round!.hand).toBeNull();
    expect(v.round!.joker).toBeNull();
  });
});

describe("others' sets and the joker (bug 2026-10-29)", () => {
  /** Joker 7♥. Mom has seen it and holds 3 pure sets + 2 joker sets; Dad hasn't seen it. */
  function setup(): Game {
    const g = new Game(3);
    g.do(0, { type: 'start' });
    const r = g.round;
    r.picked = parseCard('7H', 'picked-7H');
    r.pickedBy = g.ids[1]!;
    r.seen = [g.ids[1]!];
    r.shown = [g.ids[1]!];
    g.setHand(
      1,
      [
        cards('p1', '4S 5S 6S'),
        cards('p2', '9D 10D JD'),
        cards('p3', 'KC KC KC'),
        cards('j1', 'QD KD 7C'), // sequence held together by a joker
        cards('j2', 'AS AH 7S'), // mixed trail + joker
      ],
      cards('m', 'QS QS 2H JH 3D AC'),
    );
    return g;
  }
  const ids = (sets: { id: string }[][]) => sets.flat().map((c) => c.id);

  it('someone who has not seen the joker gets only the pure sets, never the joker sets', () => {
    const g = setup();
    const v = g.view(2); // Dad, not seen
    const mom = v.players.find((p) => p.id === g.ids[1])!;
    expect(mom.sets).toHaveLength(3);
    expect(mom.hiddenSets).toBe(2);
    const json = JSON.stringify(v);
    for (const id of ids([cards('j1', 'QD KD 7C'), cards('j2', 'AS AH 7S')])) expect(json).not.toContain(id);
    expect(json).not.toContain('picked-7H');
    expect(mom.cardCount).toBe(21);
  });

  it('once you have seen the joker you see all their sets', () => {
    const g = setup();
    g.round.seen.push(g.ids[2]!);
    const mom = g.view(2).players.find((p) => p.id === g.ids[1])!;
    expect(mom.sets).toHaveLength(5);
    expect(mom.hiddenSets).toBe(0);
  });

  it('you always see all of your own sets', () => {
    const g = setup();
    g.setHand(2, [cards('d1', '4D 5D 9C')], cards('d', 'QS'));
    const v = g.view(2);
    expect(v.players.find((p) => p.id === g.ids[2])!.sets).toHaveLength(1);
    expect(v.round!.hand!.sets).toHaveLength(1);
  });
});

describe('A♠ / 2♣ shown before play (2026-10-31)', () => {
  function fresh(): Game {
    const g = new Game(3);
    g.autoSkipOpening = false;
    g.do(0, { type: 'start' }); // Mom (1) plays first
    return g;
  }

  it('scores each kind on its own: 1 = 2, 2 = 5, 3 = 10', () => {
    const P = (k: string) => openingPoints(cards('o', k));
    expect(P('AS')).toBe(2);
    expect(P('2C')).toBe(2);
    expect(P('AS 2C')).toBe(4);
    expect(P('AS AS')).toBe(5);
    expect(P('2C 2C 2C')).toBe(10);
    expect(P('AS 2C 2C')).toBe(7);
    expect(P('2C AS AS')).toBe(7);
    expect(P('AS AS AS 2C 2C 2C')).toBe(20);
    expect(P('AH 2S KD')).toBe(0); // other aces and twos don't count
  });

  it('nobody can draw until everyone has shown or skipped', () => {
    const g = fresh();
    expect(g.view(1).round!.opening!.waitingFor).toHaveLength(3);
    expect(g.try(1, { type: 'draw', from: 'stock' })).toMatch(/Waiting for Vikram, Mom, Dad to show A♠ \/ 2♣ or skip/);
    g.do(0, { type: 'opening', show: false });
    g.do(1, { type: 'opening', show: false });
    expect(g.try(1, { type: 'draw', from: 'stock' })).toMatch(/Waiting for Dad/);
    expect(g.try(1, { type: 'opening', show: false })).toMatch(/already answered/);
    g.do(2, { type: 'opening', show: false });
    expect(g.view(1).round!.opening).toBeNull();
    expect(g.try(1, { type: 'draw', from: 'stock' })).toBeNull();
    expect(g.try(2, { type: 'opening', show: false })).toMatch(/too late/);
  });

  it('showing: every other player pays at once, cards stay in the hand', () => {
    const g = fresh();
    g.hand(1).loose = [...cards('m', 'AS 2C 2C'), ...g.hand(1).loose.filter((c) => !isOpeningCard(c)).slice(0, 18)];
    g.do(1, { type: 'opening', show: true });
    expect(g.state.totals).toEqual({ [g.ids[0]!]: -7, [g.ids[1]!]: 14, [g.ids[2]!]: -7 });
    expect(g.hand(1).loose).toHaveLength(21);
    const v = g.view(0).round!;
    expect(v.openingShows).toEqual([{ by: g.ids[1], cards: cards('m', 'AS 2C 2C'), points: 7 }]);
    expect(v.lastAction).toMatchObject({ kind: 'openingShow', points: 7 });
  });

  it("can't show without A♠ or 2♣", () => {
    const g = fresh();
    g.hand(2).loose = g.hand(2).loose.filter((c) => !isOpeningCard(c));
    expect(g.try(2, { type: 'opening', show: true })).toMatch(/no A♠ or 2♣/);
  });

  it('stopping the round gives the opening payments back', () => {
    const g = fresh();
    g.hand(1).loose.splice(0, 1, ...cards('m', 'AS'));
    g.hand(1).loose = g.hand(1).loose.filter((c, i) => i === 0 || !isOpeningCard(c));
    g.do(1, { type: 'opening', show: true });
    expect(g.state.totals[g.ids[1]!]).toBe(4);
    g.do(0, { type: 'abandonRound' });
    expect(Object.values(g.state.totals)).toEqual([0, 0, 0]);
  });

  it('the result lists the opening shows and each player\'s opening net separately', () => {
    const g = fresh();
    g.hand(2).loose.splice(0, 2, ...cards('d', 'AS AS'));
    g.hand(2).loose = g.hand(2).loose.filter((c, i) => i < 2 || !isOpeningCard(c));
    g.do(2, { type: 'opening', show: true });
    g.do(0, { type: 'opening', show: false });
    g.do(1, { type: 'opening', show: false });
    // Mom (seen, all in sets) declares at once.
    const r = g.round;
    r.picked = parseCard('7H', 'picked-7H');
    r.seen = [g.ids[1]!];
    g.setHand(1, [cards('a', '4S 5S 6S'), cards('b', '9D 10D JD'), cards('c', 'KC KC KC'), cards('e', 'AD 2D 3D'), cards('f', '10C JC QC'), cards('g', '8S 9S 10S'), cards('h', '3H 4H 5H')], []);
    g.do(1, { type: 'declare' });
    const res = g.state.result!;
    expect(res.openingShows).toHaveLength(1);
    const row = (i: number) => res.rows.find((x) => x.player === g.ids[i])!;
    expect(row(2).openingNet).toBe(10);
    expect(row(0).openingNet).toBe(-5);
    expect(row(1).openingNet).toBe(-5);
    // Totals = settlement + opening.
    for (const i of [0, 1, 2]) expect(g.state.totals[g.ids[i]!]).toBe(row(i).net + row(i).openingNet);
  });
});

describe('pairs and packing (2026-10-31)', () => {
  // 11 cards with no duplicates, to fill hands.
  const FILL = 'KH 4D 8C JS 2H 6C 10D QC 3S 9C 7D';

  it('counts pairs of identical cards; three alike is one pair', () => {
    expect(countPairs(cards('p', '7S 7S 7S 7H 8D 8D 9C'))).toBe(2);
    expect(countPairs(cards('p', '7S 7H 7D'))).toBe(0);
  });

  /** Mom (1) plays first; give her `pairs` pairs + filler. */
  function withPairs(n: number): Game {
    const g = new Game(3);
    g.do(0, { type: 'start' });
    const keys = ['AS', '3D', '5C', '9H', 'QS', 'JD', '4C'].slice(0, n);
    const pairsPart = keys.flatMap((k) => [k, k]).join(' ');
    const fill = FILL.split(' ').slice(0, 21 - 2 * n).join(' ');
    g.setHand(1, [], cards('m', `${pairsPart} ${fill}`));
    return g;
  }

  it('first turn, before drawing: 5 pairs to pack, others check, then she is out (card points 0)', () => {
    const g = withPairs(5);
    expect(g.view(1).round!.pairsWindow).toEqual({ pack: 5, declare: 6, afterDraw: false });
    expect(g.try(1, { type: 'pairs', action: 'declare' })).toMatch(/need 6 pairs to declare, you have 5/);
    g.do(1, { type: 'pairs', action: 'pack' });
    expect(g.view(0).round!.show).toMatchObject({ kind: 'pack', by: g.ids[1] });
    expect(g.view(0).round!.show!.sets).toHaveLength(5);
    g.do(0, { type: 'ack' });
    g.do(2, { type: 'ack' });
    expect(g.view(0).players[1]!.packed).toBe('pairs');
    expect(g.turnPlayer()).toBe(2); // her turn passed
    // Packed players are skipped: Dad, Vikram, Dad, …
    for (const p of [2, 0, 2]) {
      expect(g.turnPlayer()).toBe(p);
      g.do(p, { type: 'draw', from: 'stock' });
      g.do(p, { type: 'discard', cardId: g.hand(p).loose[0]!.id });
    }
    expect(g.try(1, { type: 'draw', from: 'stock' })).toMatch(/turn/);
  });

  it('first turn: 6 pairs to declare; picks the joker first, then the round ends', () => {
    const g = withPairs(6);
    g.do(1, { type: 'pairs', action: 'declare' });
    g.do(0, { type: 'ack' });
    g.do(2, { type: 'ack' });
    expect(g.round.awaitingPick).toBe(g.ids[1]);
    g.do(1, { type: 'pickJoker', index: 3 });
    expect(g.state.phase).toBe('roundOver');
    const res = g.state.result!;
    expect(res).toMatchObject({ declarer: g.ids[1], how: 'pairs' });
    const mom = res.rows.find((r) => r.player === g.ids[1])!;
    expect(mom.unused).toBe(0);
    expect(Object.values(g.state.totals).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('pairs only count on the first turn before drawing, or after drawing once everyone has had a turn', () => {
    const g = withPairs(6);
    g.do(1, { type: 'draw', from: 'stock' });
    expect(g.view(1).round!.pairsWindow).toBeNull();
    expect(g.try(1, { type: 'pairs', action: 'pack', discardId: g.hand(1).loose[0]!.id })).toMatch(/first turn/);
    g.do(1, { type: 'discard', cardId: g.hand(1).loose.at(-1)!.id });
    for (const p of [2, 0]) {
      g.do(p, { type: 'draw', from: 'stock' });
      g.do(p, { type: 'discard', cardId: g.hand(p).loose[0]!.id });
    }
    // Everyone has had a turn: now 6 to pack / 7 to declare, after drawing.
    expect(g.view(1).round!.pairsWindow).toEqual({ pack: 6, declare: 7, afterDraw: true });
    expect(g.try(1, { type: 'pairs', action: 'pack' })).toMatch(/Draw a card first/);
    g.do(1, { type: 'draw', from: 'stock' });
    expect(g.try(1, { type: 'pairs', action: 'pack' })).toMatch(/Choose the card to put down/);
    // Putting down one of a pair leaves 5: not enough.
    const pairCard = g.hand(1).loose.find((c) => c.rank === 3 && c.suit === 'D')!;
    expect(g.try(1, { type: 'pairs', action: 'pack', discardId: pairCard.id })).toMatch(/need 6 pairs to pack, you have 5/);
    const spare = g.hand(1).loose.find((c) => countPairs(g.hand(1).loose.filter((x) => x !== c)) === 6)!;
    g.do(1, { type: 'pairs', action: 'pack', discardId: spare.id });
    expect(g.round.discard.at(-1)).toEqual(spare);
    g.do(0, { type: 'ack' });
    g.do(2, { type: 'ack' });
    expect(g.view(2).players[1]!.packed).toBe('pairs');
  });

  it('pack on your own turn: 5 card points + value difference, joker visible', () => {
    const g = new Game(3);
    g.do(0, { type: 'start' });
    expect(g.try(2, { type: 'pack' })).toMatch(/Mom's turn/);
    g.do(1, { type: 'draw', from: 'stock' });
    expect(g.try(1, { type: 'pack' })).toMatch(/Choose the card to put down/);
    g.do(1, { type: 'pack', discardId: g.hand(1).loose[0]!.id });
    expect(g.hand(1).loose).toHaveLength(21);
    expect(g.view(0).players[1]!.packed).toBe('any');
    expect(g.turnPlayer()).toBe(2);
    // Dad shows, Vikram checks (Mom, packed, doesn't have to), Dad picks the joker.
    g.setHand(2, showableHand('d').sets, showableHand('d').loose.slice(0, 12));
    g.do(2, { type: 'show' });
    expect(g.view(0).round!.show!.waitingFor).toEqual([g.ids[0]]);
    g.do(0, { type: 'ack' });
    g.do(2, { type: 'pickJoker', index: 0 });
    // The joker is visible to the packed player, not to Vikram.
    expect(g.view(1).round!.joker).toEqual(g.round.picked);
    expect(g.view(0).round!.joker).toBeNull();
  });

  it('settlement: packed players pay fixed card points + declarer value − own value', () => {
    const g = new Game(4);
    g.do(0, { type: 'start' });
    const r = g.round;
    r.picked = parseCard('7H', 'picked-7H');
    r.seen = [g.ids[1]!];
    // Vikram packed any time (5 points), Dad with pairs (0), Sister plays on.
    r.packed = [
      { id: g.ids[0]!, how: 'any', points: 5 },
      { id: g.ids[2]!, how: 'pairs', points: 0 },
    ];
    g.setHand(0, [], cards('v', 'KD QD JC 9S 2S 3D 4C 5H 9D 10S JH QC KS AD 2D 3S 4H 5D 9C 10H 8H')); // 8♥ = 2 value
    g.setHand(2, [], cards('d', 'KD KD QD QD JC JC 9S 9S 2S 2S 3D AH 4C 5H 9D 10S JH QC KS 2D 3S'));
    g.setHand(1, [cards('a', '4S 5S 6S'), cards('b', '9D 10D JD'), cards('c', 'KC KC KC'), cards('e', '6H 7H 8H'), cards('f', '10C JC QC'), cards('g', '8S 9S 10S'), cards('h', '3H 4H 5H')], []);
    g.do(1, { type: 'declare' });
    const row = (i: number) => g.state.result!.rows.find((x) => x.player === g.ids[i])!;
    expect(row(0)).toMatchObject({ packed: 'any', unused: 5, value: 2, pays: 5 + 10 - 2 });
    expect(row(2)).toMatchObject({ packed: 'pairs', unused: 0, pays: 0 + 10 - 0 });
    expect(row(3).packed).toBeNull();
  });
});

describe('parseMessage', () => {
  it('accepts known message types only', () => {
    expect(parseMessage('{"type":"draw","from":"stock"}')).toEqual({ type: 'draw', from: 'stock' });
    expect(parseMessage('nope')).toBeNull();
    expect(parseMessage('[]')).toBeNull();
    expect(parseMessage('{"type":"cheat"}')).toBeNull();
    expect(parseMessage('null')).toBeNull();
  });
});
