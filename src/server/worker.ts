// Worker entry: creates tables and routes each table's WebSockets to its Durable Object.
//
//   POST /api/tables            → { code }       new table with a 4-letter code
//   GET  /api/tables/:code      → table info, or 404
//   GET  /api/tables/:code/ws   → WebSocket (Upgrade: websocket)
//
// The screens (React, added later) are served by the same Worker as static assets.

import { CODE_RE, newCode } from './codes';

// Only handlers and Durable Object classes may be exported from this file.
export { Table } from './table';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ["api", "tables", code?, "ws"?]
    if (parts[0] !== 'api' || parts[1] !== 'tables') return json({ error: 'Not found' }, 404);

    if (parts.length === 2) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      // A clash is very unlikely (31^4 ≈ 923k codes) but retry a few times anyway.
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        if (await env.TABLES.getByName(code).create(code)) return json({ code }, 201);
      }
      return json({ error: 'Could not create a table, please try again' }, 503);
    }

    const code = (parts[2] ?? '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'No such table' }, 404);
    const stub = env.TABLES.getByName(code);

    if (parts.length === 3 && request.method === 'GET') {
      const info = await stub.info();
      return info ? json(info) : json({ error: 'No such table' }, 404);
    }
    if (parts.length === 4 && parts[3] === 'ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'Expected a WebSocket' }, 426);
      }
      return stub.fetch(request);
    }
    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
