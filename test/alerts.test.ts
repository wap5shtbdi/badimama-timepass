import { describe, expect, it } from 'vitest';
import { alertFor } from '../src/client/alerts';
import { act, apply, createTable, join, type TableState, viewFor } from '../src/game/engine';
import type { ClientMessage } from '../src/game/protocol';
import { parseCard } from '../src/rules';

/** Three players; ids p0 (Vikram, host), p1 (Mom), p2 (Dad). Mom plays first. */
function table() {
  let n = 0;
  const env = { random: Math.random, newId: () => `p${n++}` };
  let s: TableState = createTable('TEST');
  for (const name of ['Vikram', 'Mom', 'Dad']) {
    const r = apply(s, (d) => join(d, `token-${name}-0123456789`, name, env));
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  const all = new Set(['p0', 'p1', 'p2']);
  const g = {
    get s() {
      return s;
    },
    set s(v: TableState) {
      s = v;
    },
    do(id: string, msg: ClientMessage) {
      const r = apply(s, (d) => act(d, id, msg, env));
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    },
    view: (id: string) => viewFor(s, id, all),
    /** Deal, then everyone skips showing A♠ / 2♣. */
    start() {
      g.do('p0', { type: 'start' });
      for (const id of ['p0', 'p1', 'p2']) g.do(id, { type: 'opening', show: false });
    },
  };
  return g;
}

const cards = (tag: string, keys: string) => keys.split(' ').map((k, i) => parseCard(k, `${tag}${i}-${k}`));

describe('turn alerts', () => {
  it('none for the first view (opening or reloading the app)', () => {
    const g = table();
    g.do('p0', { type: 'start' });
    expect(alertFor(null, g.view('p1'))).toBeNull();
  });

  it('after the deal everyone is asked about A♠ / 2♣; the first player gets "your turn" when play starts', () => {
    const g = table();
    const lobbyMom = g.view('p1');
    const lobbyDad = g.view('p2');
    g.do('p0', { type: 'start' });
    const mom0 = g.view('p1');
    expect(alertFor(lobbyMom, mom0)).toBe('check');
    expect(alertFor(lobbyDad, g.view('p2'))).toBe('check');
    g.do('p0', { type: 'opening', show: false });
    g.do('p1', { type: 'opening', show: false });
    const mom1 = g.view('p1');
    expect(alertFor(mom0, mom1)).toBeNull(); // still waiting for Dad
    const dad1 = g.view('p2');
    g.do('p2', { type: 'opening', show: false });
    expect(alertFor(mom1, g.view('p1'))).toBe('turn');
    expect(alertFor(dad1, g.view('p2'))).toBeNull();
  });

  it('alerts when the turn passes to you, once', () => {
    const g = table();
    g.start();
    g.do('p1', { type: 'draw', from: 'stock' });
    const before = g.view('p2');
    g.do('p1', { type: 'discard', cardId: g.s.round!.hands.p1!.loose[0]!.id });
    const after = g.view('p2');
    expect(alertFor(before, after)).toBe('turn');
    // Dad draws: still his turn, no second alert.
    g.do('p2', { type: 'draw', from: 'stock' });
    expect(alertFor(after, g.view('p2'))).toBeNull();
    // Others' views don't alert them.
    expect(alertFor(before, g.view('p0'))).toBeNull();
  });

  it('asks the others to check a show, then the shower to pick; no extra turn alert after', () => {
    const g = table();
    g.start();
    g.s.round!.hands.p1 = {
      sets: [cards('a', '4S 5S 6S'), cards('b', '9D 10D JD'), cards('c', 'KC KC KC')],
      loose: cards('d', 'QS QS 2H JH 3D AC 2C 5C 9C 4H 10S 8C'),
    };
    const vik0 = g.view('p0');
    const mom0 = g.view('p1');
    g.do('p1', { type: 'show' });
    const vik1 = g.view('p0');
    expect(alertFor(vik0, vik1)).toBe('check');
    expect(alertFor(mom0, g.view('p1'))).toBeNull(); // the shower isn't asked to check
    g.do('p0', { type: 'ack' });
    expect(alertFor(vik1, g.view('p0'))).toBeNull(); // already checked: no repeat
    const mom1 = g.view('p1');
    g.do('p2', { type: 'ack' });
    const mom2 = g.view('p1');
    expect(alertFor(mom1, mom2)).toBe('pick');
    g.do('p1', { type: 'pickJoker', index: 0 });
    expect(alertFor(mom2, g.view('p1'))).toBeNull(); // her turn simply continues
  });

  it('nothing on the result screen', () => {
    const g = table();
    const v = g.view('p1');
    expect(alertFor(v, { ...v, phase: 'roundOver' })).toBeNull();
  });
});
