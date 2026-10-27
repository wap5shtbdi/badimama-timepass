import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Rules and game engine: plain Node, fast.
        test: { name: 'engine', include: ['test/*.test.ts'] },
      },
      {
        // Table server: runs inside the real Workers runtime (Miniflare) with Durable Objects.
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: { name: 'server', include: ['test/worker/**/*.test.ts'] },
      },
    ],
  },
});
