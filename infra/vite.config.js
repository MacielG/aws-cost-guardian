import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['../test-setup.js'],
    environment: 'jsdom',
    coverage: {
      provider: 'c8',
      reporter: ['text', 'lcov', 'html'],
      exclude: ['node_modules', 'test/**']
    },
  }
});