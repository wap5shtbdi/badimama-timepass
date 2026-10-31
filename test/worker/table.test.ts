// Runs inside the Workers runtime (Miniflare) against the real Worker + Durable Object.
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../src/game/engine';
import type { ClientMessage, ServerMessage, TableView } from '../../src/game/protocol';
import { parseCard } from '../../src/rules';
import type { Table } from '../../src/server/table';
import { CODE_ALPHABET, newCode } from '../../src/server/codes';

const BASE = 'http://table.test';

function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(BASE + path, init));
}

async function createTable(): Promise<string> {
  const res = await api('/api/tables', { method: 'POST' });
  expect(res.status).toBe(201);
  const { code } = (await res.json()) as { code: string };
  return code;
}

/** A test player: one WebSocket plus the latest view it received. */
class Client {
  view: TableView | null = null;
  errors: string[] = [];
  private listeners: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      if (msg.type === 'state') this.view = msg.view;
      else this.errors.push(msg.message);
      for (const l of this.listeners) l();
    });
  }

  static async connect(code: string): Promise<Client> {
    const res = await api(`/api/tables/${code}/ws`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const c = new Client(ws);
    await c.until((v) => v.code === code);
    return c;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Wait until the latest view matches. */
  until(pred: (v: TableView) => boolean, timeoutMs = 2000): Promise<TableView> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.view && pred(this.view)) {
          this.listeners = this.listeners.filter((l) => l !== check);
          clearTimeout(timer);
          resolve(this.view);
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== check);
        reject(new Error(`Timed out; last view: ${JSON.stringify(this.view)?.slice(0, 400)}`));
      }, timeoutMs);
      if (!check()) this.listeners.push(check);
    });
  }

  /** Wait for the next error message. */
  nextError(timeoutMs = 2000): Promise<string> {
    const seen = this.errors.length;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.errors.length > seen) {
          this.listeners = this.listeners.filter((l) => l !== check);
          clearTimeout(timer);
          resolve(this.errors[seen]!);
        }
      };
      const timer = setTimeout(() => reject(new Error('No error received')), timeoutMs);
      this.listeners.push(check);
    });
  }

  close(): void {
    this.ws.close(1000, 'bye');
  }
}

const token = (name: string) => `test-token-${name}-0123456789`;

async function join(code: string, name: string): Promise<Client> {
  const c = await Client.connect(code);
  c.send({ type: 'hello', token: token(name), name });
  await c.until((v) => v.you !== null);
  return c;
}

async function tableOf(players: string[]) {
  const code = await createTable();
  const clients: Client[] = [];
  for (const name of players) clients.push(await join(code, name));
  const n = players.length;
  await Promise.all(clients.map((c) => c.until((v) => v.players.length === n)));
  return { code, clients, stub: env.TABLES.getByName(code) };
}

/** Host deals, then everyone skips showing A♠ / 2♣, so play can start. */
async function startPlay(clients: Client[]): Promise<void> {
  clients[0]!.send({ type: 'start' });
  await Promise.all(clients.map((c) => c.until((v) => v.phase === 'playing')));
  for (const c of clients) c.send({ type: 'opening', show: false });
  await Promise.all(clients.map((c) => c.until((v) => v.round?.opening === null)));
}

// ---------- HTTP routes ----------

describe('routes', () => {
  it('creates a table with a readable code and reports it', async () => {
    const code = await createTable();
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{4}$`));
    const info = await api(`/api/tables/${code}`);
    expect(info.status).toBe(200);
    expect(await info.json()).toEqual({ code, phase: 'lobby', players: [] });
    // Lower-case codes work too.
    expect((await api(`/api/tables/${code.toLowerCase()}`)).status).toBe(200);
  });

  it('404 for unknown tables, 426 without a WebSocket upgrade, 405 for wrong methods', async () => {
    expect((await api('/api/tables/ZZZZ')).status).toBe(404);
    expect((await api('/api/tables/ZZZZ/ws', { headers: { Upgrade: 'websocket' } })).status).toBe(404);
    expect((await api('/api/tables/0000')).status).toBe(404); // 0 isn't in the alphabet
    const code = await createTable();
    expect((await api(`/api/tables/${code}/ws`)).status).toBe(426);
    expect((await api('/api/tables')).status).toBe(405);
    expect((await api('/elsewhere')).status).toBe(404);
  });

  it('a code can only be claimed once', async () => {
    const code = await createTable();
    expect(await env.TABLES.getByName(code).create(code)).toBe(false);
  });

  it('the Worker entry exports only the handler and the Durable Object class', async () => {
    // workerd refuses to start if main exports anything else (caught by `wrangler dev`, not by
    // `deploy --dry-run` or the test pool).
    const mod = await import('../../src/server/worker');
    expect(Object.keys(mod).sort()).toEqual(['Table', 'default']);
  });

  it('newCode uses only the safe alphabet', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(new RegExp(`^[${CODE_ALPHABET}]{4}$`));
  });
});

// ---------- Playing over WebSockets ----------

describe('table over WebSockets', () => {
  it('lobby: everyone sees who joined; first player is host', async () => {
    const { clients } = await tableOf(['Vikram', 'Mom', 'Dad']);
    const v = clients[2]!.view!;
    expect(v.players.map((p) => p.name)).toEqual(['Vikram', 'Mom', 'Dad']);
    expect(v.players.every((p) => p.connected)).toBe(true);
    expect(v.hostId).toBe(clients[0]!.view!.you);
  });

  it('sends errors only to the player who made the bad move', async () => {
    const { clients } = await tableOf(['Vikram', 'Mom']);
    const err = clients[1]!.nextError();
    clients[1]!.send({ type: 'start' });
    expect(await err).toMatch(/host/);
    expect(clients[0]!.errors).toEqual([]);
    const bad = clients[0]!.nextError();
    clients[0]!.ws.send('not json');
    expect(await bad).toBe('Bad message');
  });

  it('must say hello before playing', async () => {
    const code = await createTable();
    const c = await Client.connect(code);
    const err = c.nextError();
    c.send({ type: 'start' });
    expect(await err).toMatch(/Join the table first/);
  });

  it('deals, and each player only receives their own cards', async () => {
    const { clients } = await tableOf(['Vikram', 'Mom', 'Dad']);
    clients[0]!.send({ type: 'start' });
    const views = await Promise.all(clients.map((c) => c.until((v) => v.phase === 'playing')));
    for (const v of views) {
      expect(v.round!.hand!.loose).toHaveLength(21);
      expect(v.round!.stockCount).toBe(156 - 63 - 1);
    }
    const momCards = views[1]!.round!.hand!.loose.map((c) => c.id);
    const vikramJson = JSON.stringify(views[0]);
    for (const id of momCards) expect(vikramJson).not.toContain(id);
  });

  it('after the deal, play waits until everyone has shown A♠ / 2♣ or skipped', async () => {
    const { clients } = await tableOf(['Vikram', 'Mom']);
    clients[0]!.send({ type: 'start' });
    const v = await clients[1]!.until((x) => x.phase === 'playing');
    expect(v.round!.opening!.waitingFor).toHaveLength(2);
    const err = clients[1]!.nextError();
    clients[1]!.send({ type: 'draw', from: 'stock' });
    expect(await err).toMatch(/to show A♠ \/ 2♣ or skip/);
    for (const c of clients) c.send({ type: 'opening', show: false });
    await clients[1]!.until((x) => x.round?.opening === null);
    clients[1]!.send({ type: 'draw', from: 'stock' });
    await clients[1]!.until((x) => x.round?.stage === 'discard');
  });

  it('turn flow: draw and discard reach everyone', async () => {
    const { clients } = await tableOf(['Vikram', 'Mom', 'Dad']);
    await startPlay(clients);
    const v = await clients[1]!.until((x) => x.phase === 'playing');
    const momId = v.you!;
    expect(v.round!.turn).toBe(momId);

    clients[1]!.send({ type: 'draw', from: 'stock' });
    const after = await clients[1]!.until((x) => x.round!.stage === 'discard');
    expect(after.round!.hand!.loose).toHaveLength(22);
    const card = after.round!.hand!.loose[3]!;
    clients[1]!.send({ type: 'discard', cardId: card.id });
    const seen = await clients[2]!.until((x) => x.round!.discardTop?.id === card.id);
    expect(seen.round!.turn).toBe(clients[2]!.view!.you);
    expect(seen.round!.lastAction).toEqual({ by: momId, kind: 'discarded', card });
  });

  it('survives hibernation: state reloads and sockets keep their player', async () => {
    const { clients, stub } = await tableOf(['Vikram', 'Mom']);
    await startPlay(clients);
    const before = await clients[1]!.until((v) => v.phase === 'playing');

    await evictDurableObject(stub); // in-memory state gone, WebSockets hibernated (not closed)

    clients[1]!.send({ type: 'draw', from: 'stock' });
    const after = await clients[1]!.until((v) => v.round?.stage === 'discard');
    expect(after.you).toBe(before.you);
    expect(after.round!.hand!.loose.slice(0, 21)).toEqual(before.round!.hand!.loose);
    expect(after.rev).toBe(before.rev + 1);
    // Vikram's socket also still works after the wake-up.
    await clients[0]!.until((v) => v.round?.stage === 'discard');
  });

  it('reconnecting with the same token gets the same seat and cards back', async () => {
    const { code, clients } = await tableOf(['Vikram', 'Mom', 'Dad']);
    clients[0]!.send({ type: 'start' });
    const momBefore = await clients[1]!.until((v) => v.phase === 'playing');

    clients[1]!.close();
    await clients[0]!.until((v) => v.players.find((p) => p.id === momBefore.you)!.connected === false);

    const mom = await Client.connect(code);
    // Not joined yet: public view, no hand.
    expect(mom.view!.you).toBeNull();
    expect(mom.view!.round!.hand).toBeNull();
    mom.send({ type: 'hello', token: token('Mom'), name: 'Mom' });
    const back = await mom.until((v) => v.you !== null);
    expect(back.you).toBe(momBefore.you);
    expect(back.round!.hand).toEqual(momBefore.round!.hand);
    await clients[0]!.until((v) => v.players.find((p) => p.id === back.you)!.connected);
  });

  it('a new player cannot join mid-round', async () => {
    const { code, clients } = await tableOf(['Vikram', 'Mom']);
    clients[0]!.send({ type: 'start' });
    await clients[0]!.until((v) => v.phase === 'playing');
    const late = await Client.connect(code);
    const err = late.nextError();
    late.send({ type: 'hello', token: token('Late'), name: 'Late' });
    expect(await err).toMatch(/round is being played/);
  });

  it('show → acknowledge → pick: only the shower learns the joker', async () => {
    const { clients, stub } = await tableOf(['Vikram', 'Mom', 'Dad']);
    await startPlay(clients);
    const momView = await clients[1]!.until((v) => v.phase === 'playing');
    const momId = momView.you!;

    // Give Mom 3 pure sets (server-side, as if she had been dealt them).
    const sets = [
      ['4S', '5S', '6S'],
      ['9D', '10D', 'JD'],
      ['KC', 'KC', 'KC'],
    ].map((keys, s) => keys.map((k, i) => parseCard(k, `t${s}${i}-${k}`)));
    await runInDurableObject(stub, async (instance: Table, state) => {
      const t = (instance as unknown as { state: TableState }).state;
      const hand = t.round!.hands[momId]!;
      hand.sets = sets;
      hand.loose = hand.loose.slice(0, 12);
      await state.storage.put('state', t);
    });

    clients[1]!.send({ type: 'show' });
    const dad = await clients[2]!.until((v) => v.round?.show?.by === momId);
    expect(dad.round!.show!.sets).toEqual(sets);
    expect(dad.round!.show!.waitingFor).toHaveLength(2);

    clients[0]!.send({ type: 'ack' });
    clients[2]!.send({ type: 'ack' });
    await clients[1]!.until((v) => v.round?.awaitingPick === momId);

    clients[1]!.send({ type: 'pickJoker', index: 5 });
    const mom = await clients[1]!.until((v) => v.round?.joker !== null);
    const joker = mom.round!.joker!;
    const vik = await clients[0]!.until((v) => !!v.round?.jokerPicked);
    expect(vik.round!.joker).toBeNull();
    expect(JSON.stringify(vik)).not.toContain(`"id":"${joker.id}"`); // whole id: "0-4S" is inside "t00-4S"
    expect(vik.players.find((p) => p.id === momId)!.seen).toBe(true);
  });
});
