# Badimama timepass

A private web app for playing Marriage (21-card rummy) online with family.

- Rules and decisions: [SPEC.md](SPEC.md) (the source of truth; every confirmed rule is there).
- Rules engine: `src/rules/` (shared by the server and the screens).
- Game engine: `src/game/engine.ts` (one table: lobby, turns, show/acknowledge/joker, declare, settlement) and `src/game/protocol.ts` (messages and views, shared with the screens).
- Table server: `src/server/` (Cloudflare Worker + one Durable Object per table, WebSocket hibernation).
- Tests: `test/` (rules + game engine, in Node) and `test/worker/` (the real Worker and Durable Object, in the Workers runtime).

## Commands

```sh
npm install        # also generates worker-configuration.d.ts (Worker types)
npm test           # all tests: rules, game engine, table server
npm run typecheck  # TypeScript, both Node and Workers configs
npm run dev        # local server on http://localhost:8787 (API only for now)
npm run deploy     # deploy to Cloudflare (needs `npx wrangler login` once)
```

## Talking to the table server

1. `POST /api/tables` → `{ "code": "K7Q4" }`
2. Open a WebSocket to `/api/tables/K7Q4/ws`
3. Send `{"type":"hello","token":"<secret kept on the device>","name":"Mom"}`
4. Every change arrives as `{"type":"state","view":{…}}` (that player's own view); bad moves get `{"type":"error","message":"…"}`.

All message types are in `src/game/protocol.ts`.

## Status

- [x] Rules engine with tests
- [x] Table server (Cloudflare Durable Object) with tests
- [ ] Screens (React)
- [ ] Deploy + install on phones
