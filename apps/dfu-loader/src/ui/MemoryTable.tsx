import type { DfuMemorySector } from '@arduconfig/firmware-flash'
import { formatAddress } from '../analysis/image.js'

function kib(bytes: number): string {
  return bytes >= 1024 ? `${bytes / 1024} KiB` : `${bytes} B`
}

/** Groups runs of identical consecutive sectors so a 12-sector flash reads as three rows. */
function groupSectors(sectors: readonly DfuMemorySector[]) {
  const groups: { first: DfuMemorySector; count: number }[] = []
  for (const s of sectors) {
    const last = groups[groups.length - 1]
    if (
      last &&
      last.first.size === s.size &&
      last.first.readable === s.readable &&
      last.first.erasable === s.erasable &&
      last.first.writable === s.writable
    ) {
      last.count++
    } else groups.push({ first: s, count: 1 })
  }
  return groups
}

/** The device's DfuSe memory layout. */
export function MemoryTable({ sectors }: { sectors: readonly DfuMemorySector[] }) {
  if (sectors.length === 0) return <p className="apwt-section__help">The device did not report a memory layout.</p>
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            <th>Start</th>
            <th>Sectors</th>
            <th>Sector size</th>
            <th>Read</th>
            <th>Erase</th>
            <th>Write</th>
          </tr>
        </thead>
        <tbody>
          {groupSectors(sectors).map(({ first, count }) => (
            <tr key={first.start}>
              <td>{formatAddress(first.start)}</td>
              <td>{count}</td>
              <td>{kib(first.size)}</td>
              <td>{first.readable ? 'yes' : 'no'}</td>
              <td>{first.erasable ? 'yes' : 'no'}</td>
              <td>{first.writable ? 'yes' : <span className="apwt-changed">protected</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
