import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Multi-page build: every `apps/<tool>/index.html` becomes its own entry so each
 * tool is served at `/apps/<tool>/` in dev and emitted as a self-contained page.
 */
const appsDir = resolve(__dirname, 'apps')
const input = {
  home: resolve(__dirname, 'index.html'),
  ...Object.fromEntries(
    readdirSync(appsDir)
      .filter((name) => existsSync(resolve(appsDir, name, 'index.html')))
      .map((name) => [name, resolve(appsDir, name, 'index.html')])
  )
}

export default defineConfig({
  // Relative asset URLs so the built site works from any path (e.g. /Tools/WebTools/).
  base: './',
  plugins: [react()],
  resolve: {
    // Consume ArduConfigurator's firmware-flash from source (vendored submodule) rather than its built dist.
    alias: { '@arduconfig/firmware-flash': resolve(__dirname, 'vendor/arduconfigurator/packages/firmware-flash/src/index.ts') }
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: { input }
  },
  server: { open: '/' }
})
