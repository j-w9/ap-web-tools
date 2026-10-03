import type { ConnectedInfo } from '../dfu/session.js'
import { formatSegmentProperties, hexAddr8, niceSize } from '../dfu/util.js'

/** "Name: X" lines of the USB info block as label/value pairs. */
function usbFacts(usbInfo: string): { label: string; value: string }[] {
  return usbInfo
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const colon = line.indexOf(': ')
      return { label: line.slice(0, colon), value: line.slice(colon + 2) }
    })
}

/** USB and DFU information about the connected interface, and its DfuSe memory map. */
export function DeviceInfo({ info, interfaces }: { info: ConnectedInfo; interfaces: readonly string[] }) {
  const [regionLine] = info.memorySummary.split('\n')
  return (
    <div className="dfu-device">
      <dl className="apwt-facts">
        {usbFacts(info.usbInfo).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <pre className="dfu-pre">{[info.summary, info.properties].filter((line) => line !== null).join('\n')}</pre>
      {interfaces.length > 1 && (
        <details className="dfu-interfaces">
          <summary>{interfaces.length} DFU interfaces found; the first is used</summary>
          <ul>
            {interfaces.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      {info.memory && (
        <>
          <p className="apwt-section__help">{regionLine}</p>
          <div className="apwt-table-wrap">
            <table className="apwt-table">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Sector size</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {info.memory.segments.map((segment) => (
                  <tr key={segment.start}>
                    <td>{hexAddr8(segment.start)}</td>
                    <td>{hexAddr8(segment.end - 1)}</td>
                    <td>{niceSize(segment.sectorSize)}</td>
                    <td>{formatSegmentProperties(segment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
