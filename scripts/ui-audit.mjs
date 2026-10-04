#!/usr/bin/env node
// UI audit: captures every tool (and the landing page) at desktop, tablet and phone widths in dark
// and light themes, and flags layout problems. Not part of CI; run it while auditing the UI.
//
//   node scripts/ui-audit.mjs [tool ...] [--out DIR]
//
// Writes DIR/<tool>/<state>-<viewport>-<theme>.png and DIR/report.json, and prints a summary.
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { EXPECTED_ERRORS, STATES } from './ui-audit.config.mjs'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : resolve(root, '.ui-audit'))
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'phone', width: 390, height: 844 }
]
const THEMES = ['dark', 'light']

const tools = ['home', ...readdirSync(resolve(root, 'apps')).filter((t) => existsSync(resolve(root, 'apps', t, 'index.html')))]
const selected = only.length > 0 ? tools.filter((t) => only.includes(t)) : tools

/** Layout checks run inside the page. */
function inspect() {
  const vw = document.documentElement.clientWidth
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : ''
    const cls =
      typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    return `${el.tagName.toLowerCase()}${id}${cls}`
  }
  const offscreen = []
  const clipped = []
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // Visually hidden text for screen readers (1 px, clipped on purpose).
    if (el.closest('.sr-only')) continue
    // Elements extending past the right edge, unless inside a horizontally scrollable container.
    if (r.right > vw + 1) {
      let scroller = el.parentElement
      let inScroller = false
      while (scroller && scroller !== document.body) {
        const s = getComputedStyle(scroller)
        if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) {
          inScroller = true
          break
        }
        scroller = scroller.parentElement
      }
      if (!inScroller) offscreen.push(`${describe(el)} right=${Math.round(r.right)}`)
    }
    // Text cut off by its own box (single elements with overflow hidden/ellipsis and real overflow).
    if (
      (style.overflowX === 'hidden' || style.textOverflow === 'ellipsis') &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.children.length === 0 &&
      el.textContent.trim()
    ) {
      clipped.push(`${describe(el)} "${el.textContent.trim().slice(0, 40)}"`)
    }
  }
  const brokenImages = [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src)
  return {
    horizontalOverflow: document.documentElement.scrollWidth > vw + 1 ? document.documentElement.scrollWidth - vw : 0,
    offscreen: offscreen.slice(0, 8),
    clipped: clipped.slice(0, 8),
    brokenImages
  }
}

const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  server: { port: 0, open: false },
  logLevel: 'error'
})
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch()
const report = {}
try {
  for (const tool of selected) {
    const states = [{ name: 'empty' }, ...(STATES[tool] ?? [])]
    const url = tool === 'home' ? base : `${base}apps/${tool}/`
    mkdirSync(resolve(out, tool), { recursive: true })
    for (const state of states) {
      for (const theme of THEMES) {
        for (const vp of VIEWPORTS) {
          const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
          await context.addInitScript((t) => {
            try {
              localStorage.setItem('apwt-theme', t)
            } catch {}
          }, theme)
          const page = await context.newPage()
          const errors = []
          page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
          page.on('console', (m) => {
            if (m.type() === 'error') errors.push(`console: ${m.text()}`)
          })
          try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
            if (state.files) {
              await page
                .locator('input[type=file]')
                .first()
                .setInputFiles(state.files.map((f) => resolve(root, f)))
              await page.waitForTimeout(2500)
            }
            if (state.steps) await state.steps(page)
            await page.waitForTimeout(500)
            const checks = await page.evaluate(inspect)
            const file = `${state.name}-${vp.name}-${theme}.png`
            await page.screenshot({ path: resolve(out, tool, file), fullPage: true })
            ;(report[tool] ??= []).push({
              state: state.name,
              viewport: vp.name,
              theme,
              screenshot: `${tool}/${file}`,
              ...splitErrors(tool, state.name, errors),
              ...checks
            })
          } catch (e) {
            ;(report[tool] ??= []).push({
              state: state.name,
              viewport: vp.name,
              theme,
              failed: String(e).slice(0, 300),
              ...splitErrors(tool, state.name, errors)
            })
          }
          await context.close()
        }
      }
    }
  }
} finally {
  await browser.close()
  await server.close()
}
function splitErrors(tool, stateName, all) {
  const patterns = [...(EXPECTED_ERRORS[tool]?.['*'] ?? []), ...(EXPECTED_ERRORS[tool]?.[stateName] ?? [])]
  const isExpected = (e) => patterns.some((p) => p.test(e))
  return { errors: all.filter((e) => !isExpected(e)), expectedErrors: all.filter(isExpected) }
}
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
for (const [tool, rows] of Object.entries(report)) {
  const problems = rows.filter(
    (r) =>
      r.failed || r.errors.length || r.horizontalOverflow || r.offscreen?.length || r.clipped?.length || r.brokenImages?.length
  )
  console.log(`${problems.length === 0 ? 'ok  ' : 'WARN'} ${tool}: ${rows.length} captures, ${problems.length} with findings`)
  for (const p of problems.slice(0, 6)) {
    const bits = [
      p.failed && `failed: ${p.failed}`,
      p.errors.length && `${p.errors.length} errors (${p.errors[0].slice(0, 120)})`,
      p.horizontalOverflow && `page overflows by ${p.horizontalOverflow}px`,
      p.offscreen?.length && `offscreen: ${p.offscreen[0]}`,
      p.clipped?.length && `clipped: ${p.clipped[0]}`,
      p.brokenImages?.length && `broken image`
    ].filter(Boolean)
    console.log(`       ${p.state}/${p.viewport}/${p.theme}: ${bits.join('; ')}`)
  }
}
console.log(`\nScreenshots and report.json in ${out}`)
