import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@arduconfig/firmware-flash': resolve(__dirname, 'vendor/arduconfigurator/packages/firmware-flash/src/index.ts') }
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
    environment: 'node'
  }
})
