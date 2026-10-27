import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One Worker serves both the screens (static assets) and the table server (/api/*).
export default defineConfig({
  plugins: [react(), cloudflare()],
});
