import { Q_SLIDER, qReadout, sliderToQ } from '../analysis/fit.js'

export interface WindControlsProps {
  /** Slider position, log10(q). */
  position: number
  onPositionChange: (position: number) => void
  /** Called when the user lets go of the slider: refit with the new q. */
  onCommit: () => void
}

/** Wind process-noise slider and readout (upstream `q_slider`). */
export function WindControls({ position, onPositionChange, onCommit }: WindControlsProps) {
  const { text, hint } = qReadout(sliderToQ(position))
  return (
    <label className="apwt-field af-slider">
      <span>Wind process noise q</span>
      <input
        type="range"
        min={Q_SLIDER.min}
        max={Q_SLIDER.max}
        step={Q_SLIDER.step}
        value={position}
        onChange={(e) => onPositionChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <span className="af-slider__value">
        {text} (m/s)/√s{hint && <span className="apwt-section__help"> · {hint}</span>}
      </span>
    </label>
  )
}
