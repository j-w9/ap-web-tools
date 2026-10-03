import { readFileSync } from 'node:fs'
import { DataflashLog } from '../packages/dataflash/src/index.ts'
for (const f of process.argv.slice(2)) {
  try {
    const log = DataflashLog.parse(readFileSync(f).buffer as ArrayBuffer)
    const out: string[] = []
    for (const m of ['RATE', 'PIDR', 'PIDP', 'ATT']) {
      const t = log.getNumbers(m, 'TimeUS')
      if (!t || t.length < 2) continue
      const hz = (t.length - 1) / ((t[t.length - 1]! - t[0]!) / 1e6)
      out.push(`${m}:${t.length}@${hz.toFixed(0)}Hz`)
    }
    console.log(`${f}: ${log.vehicleType()} ${(log.byteLength / 1e6).toFixed(1)}MB ${out.join(' ')}`)
  } catch (e) { console.log(`${f}: ERR ${(e as Error).message}`) }
}
