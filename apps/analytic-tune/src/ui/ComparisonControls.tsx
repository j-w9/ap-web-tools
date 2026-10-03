import { ChipLabel, RadioChips } from '@apwt/tool-shell'
import {
  CONTROL_LOOPS,
  CONTROL_LOOP_LABELS,
  controlLoopAvailable,
  type AxisType,
  type ControlLoop,
  type FrequencyUnit,
  type GainScale,
  type PhaseScale
} from '../analysis/display.js'
import type { TuneVehicle } from '../analysis/params.js'

export interface LoopChipsProps {
  vehicle: TuneVehicle
  value: ControlLoop
  onChange: (loop: ControlLoop) => void
}

/** Which control loop to compare (upstream "Control Loop"). */
export function LoopChips({ vehicle, value, onChange }: LoopChipsProps) {
  return (
    <div className="at-loops">
      <ChipLabel>Control loop</ChipLabel>
      <RadioChips
        name="control-loop"
        value={value}
        onChange={onChange}
        options={CONTROL_LOOPS.map((loop) => ({
          value: loop,
          label: CONTROL_LOOP_LABELS[loop],
          disabled: !controlLoopAvailable(loop, vehicle)
        }))}
      />
    </div>
  )
}

export interface ScaleChipsProps {
  gain: GainScale
  onGainChange: (scale: GainScale) => void
  phase: PhaseScale
  onPhaseChange: (scale: PhaseScale) => void
  frequencyAxis: AxisType
  onFrequencyAxisChange: (type: AxisType) => void
  frequencyUnit: FrequencyUnit
  onFrequencyUnitChange: (unit: FrequencyUnit) => void
}

/** Gain, phase and frequency axis scales (upstream "Graph Settings"). */
export function ScaleChips(p: ScaleChipsProps) {
  return (
    <>
      <span className="at-tool">
        <ChipLabel>Gain</ChipLabel>
        <RadioChips
          name="gain-scale"
          value={p.gain}
          onChange={p.onGainChange}
          options={[
            { value: 'dB', label: 'dB' },
            { value: 'linear', label: 'Linear' }
          ]}
        />
      </span>
      <span className="at-tool">
        <ChipLabel>Phase</ChipLabel>
        <RadioChips
          name="phase-scale"
          value={p.phase}
          onChange={p.onPhaseChange}
          options={[
            { value: 'wrapped', label: '±180°' },
            { value: 'unwrapped', label: 'Unwrapped' }
          ]}
        />
      </span>
      <span className="at-tool">
        <ChipLabel>Frequency</ChipLabel>
        <RadioChips
          name="frequency-axis"
          value={p.frequencyAxis}
          onChange={p.onFrequencyAxisChange}
          options={[
            { value: 'log', label: 'Log' },
            { value: 'linear', label: 'Linear' }
          ]}
        />
        <RadioChips
          name="frequency-unit"
          value={p.frequencyUnit}
          onChange={p.onFrequencyUnitChange}
          options={[
            { value: 'Hz', label: 'Hz' },
            { value: 'rad/s', label: 'rad/s' }
          ]}
        />
      </span>
    </>
  )
}
