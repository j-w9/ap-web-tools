// Run PID Review's loader and FFT over logs, as a quick end-to-end check outside the browser.
import { readFileSync } from 'node:fs'
import { loadLog } from '../apps/pid-review/src/analysis/load.ts'
import { computeAxisFft } from '../apps/pid-review/src/analysis/batch-fft.ts'
import { specKey } from '../apps/pid-review/src/analysis/vehicle.ts'
for (const f of process.argv.slice(2)) {
  const t0 = performance.now()
  const log = loadLog(readFileSync(f).buffer)
  const t1 = performance.now()
  const axes = log.axes.map((a) => {
    const fft = computeAxisFft(a.sets, 512)
    return `${specKey(a.spec)}:${a.paramSets.sets.length}sets@${fft?.axis.averageSampleRate.toFixed(0) ?? '-'}Hz`
  })
  console.log(`${f.split('/').pop()}: ${log.vehicle} "${log.firmware}" ${(log.endTime - log.startTime).toFixed(0)}s load ${(t1 - t0).toFixed(0)}ms`)
  console.log(`  ${axes.join('  ')}`)
}
