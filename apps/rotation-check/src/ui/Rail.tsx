import { ControlGroup, RailCard } from '@apwt/tool-shell'
import {
  ALL_ROTATIONS,
  EULER_AXES,
  isCustomRotation,
  matchesRotationSearch,
  rotationInfo,
  rotationLabel,
  type EulerAxis,
  type RotationInfo
} from '../analysis/rotations.js'

const AXIS_LABELS: Readonly<Record<EulerAxis, string>> = { roll: 'Roll (deg)', pitch: 'Pitch (deg)', yaw: 'Yaw (deg)' }

export interface RailProps {
  selected: RotationInfo
  onSelect: (rotation: RotationInfo) => void
  search: string
  onSearchChange: (search: string) => void
  /** Text shown in the angle boxes: the enum's angles, or what the user typed for a custom rotation. */
  angleText: Readonly<Record<EulerAxis, string>>
  onAngleChange: (axis: EulerAxis, text: string) => void
}

/** The control rail: searchable rotation list and the Euler angle boxes. */
export function Rail(p: RailProps) {
  const custom = isCustomRotation(p.selected)
  // Keep the current choice listed even when the search would hide it, so the list never shows
  // a selection it does not contain.
  const options = ALL_ROTATIONS.filter((r) => r === p.selected || matchesRotationSearch(r, p.search))
  return (
    <RailCard>
      <ControlGroup label="Rotation">
        <input
          className="apwt-input"
          style={{ width: '100%', boxSizing: 'border-box', margin: '6px 0' }}
          type="search"
          placeholder="Search, e.g. yaw90 or 24"
          aria-label="Search rotations"
          value={p.search}
          onChange={(e) => p.onSearchChange(e.target.value)}
        />
        <select
          className="apwt-input"
          style={{ width: '100%', boxSizing: 'border-box' }}
          size={12}
          aria-label="Rotation"
          value={String(p.selected.value)}
          onChange={(e) => {
            const info = rotationInfo(Number(e.target.value))
            if (info) p.onSelect(info)
          }}
        >
          {options.map((r) => (
            <option key={r.value} value={r.value}>
              {rotationLabel(r)}
            </option>
          ))}
        </select>
      </ControlGroup>

      <ControlGroup label="Euler angles">
        {EULER_AXES.map((axis) => (
          <label key={axis} className="apwt-field">
            <span>{AXIS_LABELS[axis]}</span>
            <input
              type="number"
              step="any"
              disabled={!custom}
              value={p.angleText[axis]}
              onChange={(e) => p.onAngleChange(axis, e.target.value)}
            />
          </label>
        ))}
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          {custom
            ? 'Intrinsic 321 order: yaw, then pitch, then roll.'
            : 'Intrinsic 321 order. Choose Custom 1 or Custom 2 to type your own angles.'}
        </p>
      </ControlGroup>
    </RailCard>
  )
}
