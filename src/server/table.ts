// One Durable Object per table. Holds the game state, talks to every player over WebSockets
// using the hibernation API (the object can sleep between moves without dropping connections,
// so idle tables cost nothing). All game logic lives in src/game/engine.ts.

import { DurableObject } from 'cloudflare:workers';
import {
  act,
  apply,
  createTable,
  type EngineEnv,
  join,
  parseMessage,
  type TableState,
  viewFor,
} from '../game/engine';
import type { ServerMessage } from '../game/protocol';

/** Stored on each WebSocket; survives hibernation. Only the public player id, never the token. */
interface Attachment {
  playerId: string | null;
}

const STATE_KEY = 'state';
/** Largest message we accept. A full arrange message is ~1–2 KB. */
const MAX_MESSAGE = 16 * 1024;

/** Uniform in [0, 1) from the platform's cryptographic random source. */
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] as number) / 2 ** 32;
}

const engineEnv: EngineEnv = {
  random: cryptoRandom,
  newId: () => crypto.randomUUID().slice(0, 8),
};

export interface TableInfo {
  code: string;
  phase: TableState['phase'];
  players: string[];
}

export class Table extends DurableObject<Env> {
  private state: TableState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Runs again every time the object wakes from hibernation: reload the saved game.
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<TableState>(STATE_KEY)) ?? null;
    });
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------- RPC from the Worker ----------

  /** Claim this object for a new table. False if the code is already in use. */
  async create(code: string): Promise<boolean> {
    if (this.state) return false;
    this.state = createTable(code);
    await this.save();
    return true;
  }

  /** For the join screen: does this table exist, and who is at it? */
  async info(): Promise<TableInfo | null> {
    if (!this.state) return null;
    return { code: this.state.code, phase: this.state.phase, players: this.state.players.map((p) => p.name) };
  }

  // ---------- WebSocket connections ----------

  async fetch(request: Request): Promise<Response> {
    if (!this.state) return new Response('No such table', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    // Until they say hello, they get the public view (lobby list, everyone's sets).
    this.sendView(server, null, this.connectedPlayers());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = this.state;
    if (!state) return ws.close(1011, 'Table not found');
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return this.sendError(ws, 'Bad message');
    const msg = parseMessage(message);
    if (!msg) return this.sendError(ws, 'Bad message');

    if (msg.type === 'hello') {
      const r = apply(state, (d) => join(d, msg.token, msg.name, engineEnv));
      if (!r.ok) return this.sendError(ws, r.error);
      ws.serializeAttachment({ playerId: r.value } satisfies Attachment);
      return this.commit(r.state);
    }

    const playerId = this.attachment(ws).playerId;
    if (!playerId) return this.sendError(ws, 'Join the table first');
    const r = apply(state, (d) => act(d, playerId, msg, engineEnv));
    if (!r.ok) return this.sendError(ws, r.error);
    await this.commit(r.state);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Close frames are answered by the runtime (compatibility date ≥ 2026-04-07).
    // Tell everyone this player went offline; their seat and cards are kept for reconnecting.
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcast(ws);
  }

  // ---------- Helpers ----------

  private attachment(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { playerId: null };
  }

  private async commit(next: TableState): Promise<void> {
    this.state = next;
    await this.save();
    // Sockets of players who left go back to the public view.
    const ids = new Set(next.players.map((p) => p.id));
    for (const ws of this.ctx.getWebSockets()) {
      const id = this.attachment(ws).playerId;
      if (id && !ids.has(id)) ws.serializeAttachment({ playerId: null } satisfies Attachment);
    }
    this.broadcast();
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, this.state);
  }

  private connectedPlayers(except?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const id = this.attachment(ws).playerId;
      if (id) ids.add(id);
    }
    return ids;
  }

  /** Send every connection its own view. `except`: a socket that is closing. */
  private broadcast(except?: WebSocket): void {
    const connected = this.connectedPlayers(except);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.sendView(ws, this.attachment(ws).playerId, connected);
    }
  }

  private sendView(ws: WebSocket, playerId: string | null, connected: Set<string>): void {
    if (!this.state) return;
    this.send(ws, { type: 'state', view: viewFor(this.state, playerId, connected) });
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: 'error', message });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closing; the close handler will update everyone.
    }
  }
}
