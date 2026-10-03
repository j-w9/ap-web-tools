import { useMemo } from 'react'
import { PlotlyChart as Chart } from '@apwt/plot'
import { Section } from '@apwt/tool-shell'
import type { AirspeedReport } from '../analysis/airspeed.js'
import type { BaroReport } from '../analysis/baro.js'
import type { CompassReport } from '../analysis/compass.js'
import { deviceLines, type SensorDevice } from '../analysis/device.js'
import type { GpsSensor } from '../analysis/gps.js'
import type { InsSensor } from '../analysis/ins.js'
import type { ParamVector3 } from '../analysis/param-arrays.js'
import type { PositionOffsets } from '../analysis/position-offsets.js'
import type { PositionedSensor } from '../analysis/position-sensors.js'
import type { SensorReport } from '../analysis/report.js'
import { Badge, Health, Table, YesNo, anyPresent, fixed, hex } from './common.js'
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

function Position({ pos }: { pos: ParamVector3 }) {
  return <>{pos.map((v) => fixed(v, 2)).join(', ')}</>
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
            <td style={{ textAlign: 'left' }}>
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
              <YesNo value={s.use === undefined ? undefined : s.use !== 0} />
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
      tools={<YesNo value={compass.enabled === undefined ? undefined : compass.enabled !== 0} />}
    >
      <Table head={['Compass', 'Device', 'Use', 'External', 'Calibrated', 'Iron cal', 'Motor cal', 'Health']}>
        {present(compass.sensors).map((s) => {
          const c = s.calibration
          return (
            <tr key={s.number}>
              <td>{s.number}</td>
              <td style={{ textAlign: 'left' }}>
                <Device device={s.device} />
              </td>
              <td>{c ? <YesNo value={c.use === undefined ? undefined : c.use !== 0} /> : '–'}</td>
              <td>{c ? <YesNo value={c.external} /> : '–'}</td>
              <td>{c ? <YesNo value={c.offsetsSet} /> : '–'}</td>
              <td>{c ? <YesNo value={c.matrixSet} /> : '–'}</td>
              <td>{c ? <YesNo value={c.motorSet} /> : '–'}</td>
              <td>
                <Health value={s.healthy} />
              </td>
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
    <Section title="Barometers" help="Barometers with wind compensation state and health through the log.">
      <Table head={['Baro', 'Device', 'Primary', 'Wind compensation', 'Health']}>
        {present(baro.sensors).map((s) => (
          <tr key={s.number}>
            <td>{s.number}</td>
            <td style={{ textAlign: 'left' }}>
              <Device device={s.device} />
            </td>
            <td>{baro.primary === s.number ? <Badge tone="accent">Primary</Badge> : ''}</td>
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
    <Section title="Airspeed sensors" help="Airspeed sensors and their health through the log.">
      <Table head={['Sensor', 'Device', 'Primary', 'Use', 'Health']}>
        {present(airspeed.sensors).map((s) => (
          <tr key={s.number}>
            <td>{s.number}</td>
            <td style={{ textAlign: 'left' }}>
              <Device device={s.device} />
            </td>
            <td>{airspeed.primary === s.number ? <Badge tone="accent">Primary</Badge> : ''}</td>
            <td>
              <YesNo value={s.use === undefined ? undefined : s.use !== 0} />
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

/** GPS receivers. */
export function GpsSection({ gps }: { gps: readonly (GpsSensor | undefined)[] }) {
  if (!anyPresent(gps)) return null
  return (
    <Section title="GPS" help="Configured receivers; the device is the one detected at boot.">
      <Table head={['GPS', 'Type', 'Detected device', 'DroneCAN node', 'Position (m)', 'Moving baseline offset (m)']}>
        {present(gps).map((g) => (
          <tr key={g.number}>
            <td>{g.number}</td>
            <td>{g.typeName === undefined ? g.type : `${g.type}: ${g.typeName}`}</td>
            <td>{g.device ?? '–'}</td>
            <td>{g.canName ?? '–'}</td>
            <td>
              <Position pos={g.pos} />
            </td>
            <td>{g.movingBase ? <Position pos={g.movingBase} /> : '–'}</td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

/** Rangefinders, optical flow and visual odometry. */
export function OtherSensorsSection({ sensors }: { sensors: SensorReport }) {
  const rows: { name: string; s: PositionedSensor }[] = [
    ...present(sensors.rangefinders).map((s) => ({ name: `Rangefinder ${s.number}`, s })),
    ...(sensors.flow ? [{ name: 'Optical flow', s: sensors.flow }] : []),
    ...(sensors.viso ? [{ name: 'Visual odometry', s: sensors.viso }] : [])
  ]
  if (rows.length === 0) return null
  return (
    <Section title="Rangefinders, flow and odometry" help="Configured type and mounting position.">
      <Table head={['Sensor', 'Type', 'Position (m)']}>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.s.type}</td>
            <td>
              <Position pos={r.s.pos} />
            </td>
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
  if (offsets.maxOffset <= 0) return null
  return (
    <Section
      title="Sensor positions"
      help="Position offsets from the centre of gravity, in the body frame (X forward, Y right, Z down)."
    >
      <Chart className="apwt-plot" style={{ height: 600 }} data={data} layout={layout} />
    </Section>
  )
}
