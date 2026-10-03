import { describeAirspeedDevice } from '../analysis/devid.js'
import type { AirspeedSensor } from '../analysis/load.js'
import { airspeedColor } from './traces.js'

const WARN = { color: 'var(--red-text)' } as const

function enabledCell(s: AirspeedSensor) {
  // A missing USE parameter is not a disabled sensor: the sensor logged data, so the parameter
  // should exist and its absence is flagged.
  if (s.use === undefined) return <span style={WARN}>{s.useName} not found</span>
  return s.use ? 'Yes' : 'No'
}

/** One row per airspeed sensor: device, primary, use and health (upstream `build_sensor_summaries`). */
export function SensorSummary({ sensors }: { sensors: readonly AirspeedSensor[] }) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            <th>Sensor</th>
            <th>Device</th>
            <th>Use</th>
            <th>Health</th>
            <th>Logged ratio</th>
          </tr>
        </thead>
        <tbody>
          {sensors.map((s, i) => (
            <tr key={s.instance}>
              <td>
                <span className="apwt-chip__swatch af-swatch" style={{ background: airspeedColor(i) }} />
                Airspeed {s.instance + 1}
                {s.primary && (
                  <>
                    {' '}
                    <span className="apwt-badge">primary</span>
                  </>
                )}
              </td>
              <td>{describeAirspeedDevice(s.devId, s.instance)}</td>
              <td>{enabledCell(s)}</td>
              <td>{s.healthy ? 'Healthy' : <span style={WARN}>Unhealthy</span>}</td>
              <td>{s.currentRatio !== undefined ? s.currentRatio.toFixed(3) : 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
