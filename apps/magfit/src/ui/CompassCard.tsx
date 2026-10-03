import { decodeDevId, describeDevId, DeviceType } from '@apwt/ardupilot'
import { ChipLabel, Chip, RadioChips } from '@apwt/tool-shell'
import type { CompassFitResult } from '../analysis/magfit.js'
import type { OrientationOption } from '../analysis/orientation.js'
import type { UseOverride } from '../analysis/params.js'
import { rotationName } from '../analysis/rotations.js'
import type { Calibration, CalibrationId, CompassSelection } from './calibrations.js'

/** Props of {@link CompassCard}. */
export interface CompassCardProps {
  index: number
  result: CompassFitResult
  calibrations: readonly Calibration[]
  /** Colour of each calibration, as used in the plots. */
  colors: ReadonlyMap<CalibrationId, string>
  selection: CompassSelection
  savedId: CalibrationId | undefined
  onToggle: (id: CalibrationId, show: boolean) => void
  orientation: OrientationOption
  onOrientationChange: (option: OrientationOption) => void
  use: UseOverride
  onUseChange: (use: UseOverride) => void
}

const USE_OPTIONS: readonly { value: UseOverride; label: string }[] = [
  { value: 'noChange', label: 'No change' },
  { value: 'use', label: 'Use' },
  { value: 'dontUse', label: "Don't use" }
]

/** Minimum attitude coverage upstream calls good. */
const GOOD_COVERAGE = 0.3

function Flag({ on, children }: { on: boolean; children: string }) {
  return <span className={on ? 'apwt-badge' : 'apwt-badge apwt-badge--gray'}>{`${children}: ${on ? 'yes' : 'no'}`}</span>
}

/** Status, options and calibration choice for one compass (upstream per-MAG fieldset). */
export function CompassCard(p: CompassCardProps) {
  const compass = p.result.prepared.compass
  const params = compass.params
  const check = p.result.orientationCheck
  const coverage = p.result.coverage
  const groups = [...new Set(p.calibrations.filter((c) => c.id !== 'existing').map((c) => c.group))]
  const chip = (c: Calibration) => (
    <Chip
      key={c.id}
      type="checkbox"
      checked={p.selection.shown.has(c.id)}
      disabled={!c.valid}
      swatch={c.valid ? p.colors.get(c.id) : undefined}
      title={c.valid ? `Mean error ${c.meanError.toFixed(1)} mGauss` : 'No valid solution: parameters outside the typical range'}
      onChange={(on) => p.onToggle(c.id, on)}
    >
      {c.kindLabel}
      {c.valid && <span className="magfit-chip-value">{c.meanError.toFixed(0)}</span>}
      {p.savedId === c.id && <span className="magfit-chip-saved">save</span>}
    </Chip>
  )

  return (
    <div className="magfit-compass">
      <div className="magfit-compass__head">
        <h3>Compass {p.index + 1}</h3>
        <span className="magfit-note">{describeDevId(decodeDevId(params.id, DeviceType.compass))}</span>
      </div>
      <div className="apwt-readout">
        <Flag on={params.use !== 0 && !Number.isNaN(params.use)}>Use</Flag>
        <Flag on={params.external > 0}>External</Flag>
        <Flag on={compass.healthy}>Healthy</Flag>
      </div>

      <div
        className="magfit-coverage"
        title="Share of all vehicle orientations, including upside down, present in the analysis window"
      >
        <span>Coverage</span>
        <meter min={0} max={1} low={GOOD_COVERAGE} optimum={1} value={coverage} />
        <span className={coverage < GOOD_COVERAGE ? 'magfit-warn-text' : undefined}>{(coverage * 100).toFixed(0)} %</span>
      </div>
      {coverage < GOOD_COVERAGE && (
        <p className="magfit-note">Below 30 %: a longer flight with more varied orientations will give more confidence.</p>
      )}

      <div className="magfit-compass__options">
        <ChipLabel>Use sensor</ChipLabel>
        <RadioChips name={`use-${String(p.index)}`} options={USE_OPTIONS} value={p.use} onChange={p.onUseChange} />
        <ChipLabel>Orientation</ChipLabel>
        <RadioChips
          name={`orientation-${String(p.index)}`}
          options={[
            { value: 'check', label: 'Check', disabled: !compass.rotated },
            { value: 'fix90', label: 'Fix 90°', disabled: !compass.rotated },
            { value: 'fix45', label: 'Fix 45°', disabled: !compass.rotated }
          ]}
          value={p.orientation}
          onChange={p.onOrientationChange}
        />
      </div>
      {check ? (
        <p className="magfit-note">
          {check.isCorrect ? 'Orientation looks right: ' : 'Orientation may be wrong: '}
          {String(rotationName(check.current))}
          {p.result.orientation !== check.current && `, fixed to ${String(rotationName(p.result.orientation))}`}. Cost ratio{' '}
          {check.costRatio.toFixed(2)}.
        </p>
      ) : (
        <p className="magfit-note">Orientation is only checked for external compasses.</p>
      )}
      {check?.warning !== undefined && <p className="magfit-warning">{check.warning}</p>}

      <div className="magfit-compass__cals">
        <div className="apwt-chips">{p.calibrations.filter((c) => c.id === 'existing').map(chip)}</div>
        {groups.map((g) => (
          <div key={g}>
            <ChipLabel>{g}</ChipLabel>
            <div className="apwt-chips">{p.calibrations.filter((c) => c.id !== 'existing' && c.group === g).map(chip)}</div>
          </div>
        ))}
        {!p.calibrations.some((c) => c.id !== 'existing' && c.valid) && (
          <p className="magfit-warning">
            No valid calibration found. A longer flight with better coverage gives a better chance.
          </p>
        )}
      </div>
    </div>
  )
}
