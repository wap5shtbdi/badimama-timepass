# Badimama timepass

A private web app for playing Marriage (21-card rummy) online with family.

- Rules and decisions: [SPEC.md](SPEC.md) (the source of truth; every confirmed rule is there).
- Rules engine: `src/rules/` (shared by the server and the screens).
- Game engine: `src/game/engine.ts` (one table: lobby, turns, show/acknowledge/joker, declare, settlement) and `src/game/protocol.ts` (messages and views, shared with the screens).
- Table server: `src/server/` (Cloudflare Worker + one Durable Object per table, WebSocket hibernation).
- Screens: `src/client/` (React), served by the same Worker; `public/` holds the app icon, manifest and service worker.
- Tests: `test/` (rules, game engine, screens logic, in Node) and `test/worker/` (the real Worker and Durable Object, in the Workers runtime).

## Commands

```sh
npm install        # also generates worker-configuration.d.ts (Worker types)
npm run dev        # app + table server on http://localhost:5173
npm test           # all tests: rules, game engine, screens logic, table server
npm run typecheck  # TypeScript: rules/engine, server, screens, config
npm run preview    # build, then run the built app locally (http://localhost:4173)
npm run deploy     # build and deploy to Cloudflare (run `npx wrangler login` once first)
```

## First deploy and installing on phones

1. `npx wrangler login` (opens the browser, log in to your Cloudflare account).
2. `npm run deploy`. Wrangler prints the address, e.g. `https://badimama-timepass.<your-subdomain>.workers.dev`.
3. On each Android phone: open that address in Chrome → menu (⋮) → **Add to home screen / Install app**. It opens full screen and sideways.
4. Create a table, tap **Share invite on WhatsApp**, everyone taps the link.

## Talking to the table server

1. `POST /api/tables` → `{ "code": "K7Q4" }`
2. Open a WebSocket to `/api/tables/K7Q4/ws`
3. Send `{"type":"hello","token":"<secret kept on the device>","name":"Mom"}`
4. Every change arrives as `{"type":"state","view":{…}}` (that player's own view); bad moves get `{"type":"error","message":"…"}`.

All message types are in `src/game/protocol.ts`.

## Status

- [x] Rules engine with tests
- [x] Table server (Cloudflare Durable Object) with tests
- [x] Screens (React), installable on phones
- [ ] Deploy (needs your Cloudflare login) + try on the parents' phones
