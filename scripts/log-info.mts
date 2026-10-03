// Print vehicle detection inputs for logs: VER fields and the first banner-like MSG lines.
import { readFileSync } from 'node:fs'
import { DataflashLog } from '../packages/dataflash/src/index.ts'
for (const f of process.argv.slice(2)) {
  const log = DataflashLog.parse(readFileSync(f).buffer)
  const ver = log.has('VER') ? Object.fromEntries(log.fieldNames('VER').map((k) => [k, log.get('VER', k)?.[0]])) : null
  console.log(f.split('/').pop())
  console.log('  vehicleType:', log.vehicleType(), '| VER:', JSON.stringify(ver))
  console.log('  MSG head:', JSON.stringify(log.textMessages().slice(0, 6)))
  console.log('  has PID/RATE:', ['PIDR', 'PIDP', 'PIDY', 'RATE'].filter((m) => log.has(m)).join(','))
}
