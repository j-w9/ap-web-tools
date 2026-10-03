import { Calculator } from 'lucide-react'
import { ControlGroup, LogInput, RadioChips, RailCard, type LogFact } from '@apwt/tool-shell'
import {
  TEMP_SOURCE_KEYS,
  tempSourceLabel,
  type TempChoice,
  type TempSources,
  type TemperatureReadout
} from '../analysis/temperature.js'

export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  /** Velocity source names; empty before a log is loaded. */
  sources: readonly string[]
  source: string
  onSourceChange: (name: string) => void
  tempSources: TempSources
  tempChoice: TempChoice
  onTempChoiceChange: (choice: TempChoice) => void
  groundTempText: string
  onGroundTempTextChange: (text: string) => void
  readout: TemperatureReadout | null
  window: readonly [number, number]
  windowLimits: readonly [number, number] | null
  onWindowChange: (window: readonly [number, number]) => void
  calculateEnabled: boolean
  onCalculate: () => void
}

function formatReadout(r: TemperatureReadout): { label: string; value: string }[] {
  const pct = r.eas2tasPercent
  return [
    { label: 'Field elevation', value: r.fieldElevationM !== null ? `${r.fieldElevationM.toFixed(0)} m` : 'n/a' },
    { label: 'Density altitude', value: r.densityAltitudeM !== null ? `${r.densityAltitudeM.toFixed(0)} m` : 'n/a' },
    { label: 'Avg EAS2TAS', value: pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : 'n/a' }
  ]
}

/** The control rail: log input, velocity source, air temperature, analysis window and Calculate. */
export function Rail(p: RailProps) {
  const loaded = p.windowLimits !== null
  const tempOptions = [
    ...TEMP_SOURCE_KEYS.flatMap((key) => {
      const value = p.tempSources[key]
      return value === undefined ? [] : [{ value: key, label: tempSourceLabel(key, value) }]
    }),
    { value: 'custom' as const, label: 'Custom' }
  ]
  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput facts={p.facts} onFile={p.onFile} hint="Needs ARSP, XKF1 or NKF1, BARO and POS messages" />
      </ControlGroup>

      <ControlGroup label="Velocity source">
        {p.sources.length > 0 ? (
          <RadioChips
            name="velocity-source"
            options={p.sources.map((s) => ({ value: s, label: s, disabled: p.sources.length === 1 }))}
            value={p.source}
            onChange={p.onSourceChange}
          />
        ) : (
          <p className="apwt-section__help">EKF cores appear here once a log is open.</p>
        )}
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          EKF ground velocity used as the truth for the wind triangle. The lowest core is normally fine.
        </p>
      </ControlGroup>

      <ControlGroup label="Air temperature">
        <RadioChips name="temp-source" options={tempOptions} value={p.tempChoice} onChange={p.onTempChoiceChange} />
        <label className="apwt-field">
          <span>Ground temperature (°C)</span>
          <input
            type="number"
            step={1}
            disabled={!loaded}
            value={p.groundTempText}
            onChange={(e) => p.onGroundTempTextChange(e.target.value)}
          />
        </label>
        {p.readout && (
          <dl className="apwt-facts">
            {formatReadout(p.readout).map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          Outside air temperature at ground level, lapsed to altitude to convert equivalent to true airspeed. Each degree of error
          is about 0.2% in calibrated airspeed.
        </p>
      </ControlGroup>

      <ControlGroup label="Analysis window">
        {(['Start (s)', 'End (s)'] as const).map((label, i) => (
          <label key={label} className="apwt-field">
            <span>{label}</span>
            <input
              type="number"
              step={1}
              disabled={!loaded}
              min={p.windowLimits?.[0]}
              max={p.windowLimits?.[1]}
              value={p.window[i]}
              onChange={(e) => {
                const v = Number(e.target.value)
                p.onWindowChange(i === 0 ? [v, p.window[1]] : [p.window[0], v])
              }}
            />
          </label>
        ))}
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          Seeded from the detected flight. Or zoom the flight data plot; pick turns or a loiter at steady airspeed.
        </p>
      </ControlGroup>

      <div className="apwt-group">
        <button
          type="button"
          className="apwt-btn apwt-btn--primary apwt-btn--block"
          disabled={!p.calculateEnabled}
          onClick={p.onCalculate}
        >
          <Calculator />
          Calculate
        </button>
      </div>
    </RailCard>
  )
}
