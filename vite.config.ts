import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Multi-page build: every top-level `.html` file in `apps/<tool>/` becomes an entry, so each tool
 * is served at `apps/<tool>/` and any extra page it needs (e.g. a widget sandbox) is built too.
 */
const appsDir = resolve(__dirname, 'apps')
const input: Record<string, string> = { home: resolve(__dirname, 'index.html') }
for (const name of readdirSync(appsDir)) {
  const dir = resolve(appsDir, name)
  if (!existsSync(resolve(dir, 'index.html'))) continue
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    input[file === 'index.html' ? name : `${name}-${file.replace(/\.html$/, '')}`] = resolve(dir, file)
  }
}

export default defineConfig({
  // Relative asset URLs so the built site works from any path (e.g. /Tools/WebTools/).
  base: './',
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: { input }
  },
  server: { open: '/' }
})
