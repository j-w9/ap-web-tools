/**
 * Regenerates `src/generated/` from the vendored XML in `definitions/`.
 *
 *   npm run generate               (from packages/mavlink), or
 *   npx tsx packages/mavlink/scripts/generate.ts
 *
 * `src/generated.test.ts` runs the same generation in memory and fails if the checked-in files differ.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GENERATED_DIR, generateSources } from './emit.js'

const sources = await generateSources()
mkdirSync(GENERATED_DIR, { recursive: true })
for (const [file, contents] of sources) {
  writeFileSync(join(GENERATED_DIR, file), contents)
  console.log(`wrote src/generated/${file} (${Math.round(contents.length / 1024)} KiB)`)
}
