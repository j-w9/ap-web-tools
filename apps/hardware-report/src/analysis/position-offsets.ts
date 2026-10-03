/**
 * Sensor position offsets relative to the CG for the 3D offset plot (upstream
 * `update_pos_plot()`). Only data is produced; plot traces are built by the UI.
 */
import type { GpsSensor } from './gps.js'
import type { InsSensor } from './ins.js'
import { isCompleteVector, type ParamVector3 } from './param-arrays.js'
import type { PositionedSensor } from './position-sensors.js'

/** One plotted sensor position, metres in body frame (X forward, Y right, Z down). */
export interface OffsetPoint {
  /** Legend name, e.g. `"IMU 1"`, `"GPS 1 Master"`, `"Rangefinder 3"`. */
  readonly name: string
  /** Position. */
  readonly pos: readonly [number, number, number]
}

/** Points for the offset plot plus the symmetric axis range upstream applies. */
export interface PositionOffsets {
  /** Sensors with a complete position, in upstream trace order. */
  readonly points: readonly OffsetPoint[]
  /** Largest absolute component; the plot is shown only when this is > 0. */
  readonly maxOffset: number
}

/** Inputs to {@link positionOffsets}. */
export interface OffsetSensors {
  /** IMU slots. */
  readonly ins: readonly (InsSensor | undefined)[]
  /** GPS slots. */
  readonly gps: readonly (GpsSensor | undefined)[]
  /** Rangefinder slots. */
  readonly rangefinders: readonly (PositionedSensor | undefined)[]
  /** Optical flow. */
  readonly flow: PositionedSensor | undefined
  /** Visual odometry. */
  readonly viso: PositionedSensor | undefined
}

/**
 * Collect sensor positions. For a GPS with moving-baseline offsets the receiver is the
 * "Master" and a "Slave" point is added at `pos - movingBase`, as upstream.
 */
export function positionOffsets(sensors: OffsetSensors): PositionOffsets {
  const points: OffsetPoint[] = []
  let maxOffset = 0
  const add = (name: string, pos: readonly [number, number, number]): void => {
    points.push({ name, pos })
    maxOffset = Math.max(maxOffset, Math.abs(pos[0]), Math.abs(pos[1]), Math.abs(pos[2]))
  }
  const addIfValid = (name: string, pos: ParamVector3 | undefined): void => {
    if (pos !== undefined && isCompleteVector(pos)) add(name, pos)
  }

  sensors.ins.forEach((s, i) => addIfValid(`IMU ${i + 1}`, s?.pos))
  sensors.gps.forEach((s, i) => {
    const name = `GPS ${i + 1}`
    if (s === undefined || !isCompleteVector(s.pos)) return
    const mb = s.movingBase
    if (mb !== undefined && isCompleteVector(mb)) {
      add(name + ' Master', s.pos)
      add(name + ' Slave', [s.pos[0] - mb[0], s.pos[1] - mb[1], s.pos[2] - mb[2]])
    } else {
      add(name, s.pos)
    }
  })
  sensors.rangefinders.forEach((s, i) => addIfValid(`Rangefinder ${i + 1}`, s?.pos))
  addIfValid('FLOW 1', sensors.flow?.pos)
  addIfValid('VISO 1', sensors.viso?.pos)
  return { points, maxOffset }
}
