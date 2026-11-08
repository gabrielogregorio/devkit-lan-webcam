import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The Python server (server.py) serves web/dist; `pnpm dev` is only for working on the pages.
export default defineConfig({
  root: 'web',
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: { tsconfigPaths: true },
  plugins: [react()],
  test: {
    root: '.',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['web/src/testSetup.ts'],
    include: ['web/src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['web/src/**/*.{ts,tsx}'],
      exclude: [
        'web/src/**/*.test.{ts,tsx}',
        'web/src/testSetup.ts',
        'web/src/testDoubles.ts',
        'web/src/testRender.tsx',
        'web/src/main.tsx',
        // Needs a real camera, canvas and socket: covered by the E2E in tests/e2e.
        'web/src/lib/cameraStreamer.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
