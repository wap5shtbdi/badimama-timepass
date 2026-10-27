# Badimama timepass

A private web app for playing Marriage (21-card rummy) online with family.

- Rules and decisions: [SPEC.md](SPEC.md) (the source of truth; every confirmed rule is there).
- Rules engine: `src/rules/` (shared by the server and the screens).
- Tests: `test/` (built from the confirmed rule examples).

## Run the tests

```sh
npm install
npm test          # rules engine tests
npm run typecheck # TypeScript check
```

## Status

- [x] Rules engine with tests
- [ ] Table server (Cloudflare Durable Object)
- [ ] Screens (React)
- [ ] Deploy + install on phones
