import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The mathematical core is consumed straight from source. There is no build
      // step between the two packages and no duplicated type definitions, so a
      // change in the core is visible in the application immediately.
      '@mathviz/mathcore': fileURLToPath(new URL('../mathcore/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Bound to the IPv4 loopback explicitly. The default can listen only on the
    // IPv6 loopback, which some browsers do not reach when resolving `localhost`.
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
  },
});
