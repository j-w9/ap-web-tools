import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
    environment: 'node',
    // Oracle tests run the upstream JavaScript side by side; they take several seconds on CI runners.
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
