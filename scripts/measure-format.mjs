// Count lines each candidate Prettier config would change in the existing code, so the
// adopted style is the one closest to what is already written.
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import * as prettier from 'prettier'

const files = execSync("git ls-files -co --exclude-standard -- 'packages/**/*.ts' 'packages/**/*.tsx' 'apps/pid-review/**/*.ts' 'apps/pid-review/**/*.tsx'", { encoding: 'utf8' })
  .split('\n').filter((f) => f && !f.includes('/dist/') && existsSync(f))

function changedLines(a, b) {
  const x = a.split('\n'), y = b.split('\n')
  // LCS-free approximation: count lines present in one but not the other (multiset diff).
  const count = new Map()
  for (const l of x) count.set(l, (count.get(l) ?? 0) + 1)
  let added = 0
  for (const l of y) { const c = count.get(l) ?? 0; if (c > 0) count.set(l, c - 1); else added++ }
  let removed = 0
  for (const c of count.values()) removed += c
  return added + removed
}

const results = []
for (const printWidth of (process.argv[2] ?? '100,110,120,130').split(',').map(Number)) {
  for (const trailingComma of (process.argv[3] ?? 'none,es5,all').split(',')) {
    const options = { semi: false, singleQuote: true, printWidth, trailingComma, arrowParens: 'always' }
    let total = 0
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      total += changedLines(src, await prettier.format(src, { ...options, filepath: f }))
    }
    results.push({ printWidth, trailingComma, total })
  }
}
results.sort((a, b) => a.total - b.total)
console.log(`${files.length} files`)
for (const r of results) console.log(`printWidth=${r.printWidth} trailingComma=${r.trailingComma}: ${r.total} lines`)
