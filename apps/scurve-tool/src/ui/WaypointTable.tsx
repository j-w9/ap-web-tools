import {
  AXIS_INPUT,
  WAYPOINT_AXES,
  WAYPOINT_INDICES,
  WAYPOINT_INFO,
  type Mission,
  type WaypointAxis,
  type WaypointIndex
} from '../analysis/waypoints.js'
import { NumberField } from './NumberField.js'

export interface WaypointTableProps {
  mission: Mission
  onChange: (index: WaypointIndex, axis: WaypointAxis, value: number) => void
}

/** The four mission waypoints, editable North/East/Up. */
export function WaypointTable({ mission, onChange }: WaypointTableProps) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table scurve-waypoints">
        <thead>
          <tr>
            <th>Waypoint</th>
            {WAYPOINT_AXES.map((axis) => (
              <th key={axis}>{AXIS_INPUT[axis].label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WAYPOINT_INDICES.map((index) => {
            const info = WAYPOINT_INFO[index]
            return (
              <tr key={index}>
                <td title={info.help}>
                  <span className="scurve-waypoints__name">{info.label}</span>
                  <span className="scurve-waypoints__help">{info.help}</span>
                </td>
                {WAYPOINT_AXES.map((axis) => {
                  const limits = AXIS_INPUT[axis]
                  const value = mission[index][axis]
                  return (
                    <td key={axis} className="apwt-field">
                      <NumberField
                        key={value}
                        value={value}
                        min={limits.min}
                        max={limits.max}
                        step={limits.step}
                        ariaLabel={`${info.label} ${limits.label}`}
                        onCommit={(v) => onChange(index, axis, v)}
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
