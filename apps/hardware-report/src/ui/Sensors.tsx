import { useMemo } from 'react'
import { Chart } from './Chart.js'
import { Section } from '@apwt/tool-shell'
import type { AirspeedReport } from '../analysis/airspeed.js'
import type { BaroReport } from '../analysis/baro.js'
import type { CompassReport } from '../analysis/compass.js'
import { deviceLines, type SensorDevice } from '../analysis/device.js'
import type { GpsSensor } from '../analysis/gps.js'
import type { InsSensor } from '../analysis/ins.js'
import type { PositionOffsets } from '../analysis/position-offsets.js'
import { Health, Table, YesNo, anyPresent, hex } from './common.js'
import { offsetLayout, offsetTraces } from './traces.js'

function Device({ device }: { device: SensorDevice }) {
  const lines = deviceLines(device)
  return (
    <span title={`Device id ${device.devId} (${hex(device.devId)})`}>
      {lines.map((l, i) => (
        <span key={i} style={{ display: 'block' }}>
          {l}
        </span>
      ))}
    </span>
  )
}

/** Upstream's `"Primary: " + (PRIMARY + 1)`, which reads `NaN` when the parameter is missing. */
function primaryText(primary: number | undefined): string {
  return String(primary ?? NaN)
}

function present<T>(list: readonly (T | undefined)[]): T[] {
  return list.filter((x): x is T => x !== undefined)
}

/** Inertial sensors. */
export function InsSection({ ins }: { ins: readonly (InsSensor | undefined)[] }) {
  if (!anyPresent(ins)) return null
  return (
    <Section title="Inertial sensors" help="Gyros and accelerometers, their calibration state and health through the log.">
      <Table
        head={[
          'IMU',
          'Device',
          'Use',
          'Accel cal',
          'Gyro cal',
          'Accel temp cal',
          'Gyro temp cal',
          'Position set',
          'Accel health',
          'Gyro health'
        ]}
      >
        {present(ins).map((s) => (
          <tr key={s.number}>
            <td>{s.number}</td>
            <td>
              {s.combined ? (
                <Device device={s.gyro} />
              ) : (
                <>
                  <span style={{ display: 'block' }}>Gyro:</span>
                  <Device device={s.gyro} />
                  <span style={{ display: 'block' }}>Accel:</span>
                  <Device device={s.accel} />
                </>
              )}
            </td>
            <td>
              <YesNo value={Boolean(s.use)} />
            </td>
            <td>
              <YesNo value={s.accelCalibrated} />
            </td>
            <td>
              <YesNo value={s.gyroCalibrated} />
            </td>
            <td>
              <YesNo value={s.accelTempCalibrated} />
            </td>
            <td>
              <YesNo value={s.gyroTempCalibrated} />
            </td>
            <td>
              <YesNo value={s.posSet} />
            </td>
            <td>
              <Health value={s.accelHealthy} />
            </td>
            <td>
              <Health value={s.gyroHealthy} />
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

/** Compasses. */
export function CompassSection({ compass }: { compass: CompassReport }) {
  if (!anyPresent(compass.sensors)) return null
  return (
    <Section
      title="Compasses"
      help="Compasses in priority order, then other detected compasses. Calibration is only known for the prioritised ones."
      tools={
        <>
          Enabled <YesNo value={Boolean(compass.enabled)} />
        </>
      }
    >
      <Table head={['Compass', 'Device', 'Use', 'External', 'Calibrated', 'Iron cal', 'Motor cal', 'Health']}>
        {present(compass.sensors).map((s) => {
          const c = s.calibration
          return (
            <tr key={s.number}>
              <td>{s.number}</td>
              <td>
                <Device device={s.device} />
              </td>
              <td>{c ? <YesNo value={Boolean(c.use)} /> : '–'}</td>
              <td>{c ? <YesNo value={c.external} /> : '–'}</td>
              <td>{c ? <YesNo value={c.offsetsSet} /> : '–'}</td>
              <td>{c ? <YesNo value={c.matrixSet} /> : '–'}</td>
              <td>{c ? <YesNo value={c.motorSet} /> : '–'}</td>
              <td>{c ? <Health value={s.healthy} /> : '–'}</td>
            </tr>
          )
        })}
      </Table>
    </Section>
  )
}

/** Barometers. */
export function BaroSection({ baro }: { baro: BaroReport }) {
  if (!anyPresent(baro.sensors)) return null
  return (
    <Section
      title="Barometers"
      help="Barometers with wind compensation state and health through the log."
      tools={<>Primary: {primaryText(baro.primary)}</>}
    >
      <Table head={['Baro', 'Device', 'Wind compensation', 'Health']}>
        {present(baro.sensors).map((s) => (
          <tr key={s.number}>
            <td>{s.number}</td>
            <td>
              <Device device={s.device} />
            </td>
            <td>
              <YesNo value={s.windCompensation} />
            </td>
            <td>
              <Health value={s.healthy} />
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

/** Airspeed sensors. */
export function AirspeedSection({ airspeed }: { airspeed: AirspeedReport }) {
  if (!anyPresent(airspeed.sensors)) return null
  return (
    <Section
      title="Airspeed sensors"
      help="Airspeed sensors and their health through the log."
      tools={<>Primary: {primaryText(airspeed.primary)}</>}
    >
      <Table head={['Sensor', 'Device', 'Use', 'Health']}>
        {present(airspeed.sensors).map((s) => (
          <tr key={s.number}>
            <td>{s.number}</td>
            <td>
              <Device device={s.device} />
            </td>
            <td>
              <YesNo value={Boolean(s.use)} />
            </td>
            <td>
              <Health value={s.healthy} />
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

/** GPS receivers: as upstream, only those named by a boot message are listed. */
export function GpsSection({ gps }: { gps: readonly (GpsSensor | undefined)[] }) {
  const detected = present(gps).filter((g) => g.device !== undefined)
  if (detected.length === 0) return null
  return (
    <Section title="GPS" help="Configured receivers detected at boot.">
      <Table head={['GPS', 'Type', 'Detected device', 'DroneCAN node']}>
        {detected.map((g) => (
          <tr key={g.number}>
            <td>{g.number}</td>
            <td>{g.typeName === undefined ? '' : `${g.type}: ${g.typeName}`}</td>
            <td>{g.device}</td>
            <td>{g.canName ?? ''}</td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

/** 3D plot of sensor positions; hidden when every offset is zero. */
export function OffsetsSection({ offsets }: { offsets: PositionOffsets }) {
  const data = useMemo(() => offsetTraces(offsets), [offsets])
  const layout = useMemo(() => offsetLayout(offsets.maxOffset), [offsets])
  // Upstream shows the plot only when `max_offset > 0`, so a NaN offset hides it.
  if (!(offsets.maxOffset > 0)) return null
  return (
    <Section
      title="Sensor positions"
      help="Position offsets from the centre of gravity, in the body frame (X forward, Y right, Z down)."
    >
      <Chart className="apwt-plot" style={{ height: 600 }} data={data} layout={layout} />
    </Section>
  )
}
