import { OpenInButton } from '@apwt/tool-shell'
import { ALL_SPEC_KEYS, specLabel, type PidMessageSpec } from '../analysis/vehicle.js'
import { specKey } from '../analysis/vehicle.js'

export interface SetupPanelProps {
  windowSize: number
  onWindowSizeChange: (size: number) => void
  timeRange: [number, number]
  timeLimits: [number, number] | null
  onTimeRangeChange: (range: [number, number]) => void
  /** Specs that have data in the loaded log. */
  availableSpecs: readonly PidMessageSpec[]
  selectedSpecKey: string | null
  onSelectSpec: (key: string) => void
  file: File | null
  messageTypes: readonly string[] | null
  onFile: (file: File) => void
  calculateEnabled: boolean
  onCalculate: () => void
}

const SPEC_COLUMNS: readonly (readonly string[])[] = [
  ['RATE_R', 'RATE_P', 'RATE_Y'],
  ['PIDR', 'PIDP', 'PIDY'],
  ['PIQR', 'PIQP', 'PIQY'],
  ['PIDS', 'PIDA']
]

const SPEC_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_SPEC_KEYS.map((key) => {
    const [msg, axis] = key.split('_')
    const spec: PidMessageSpec =
      axis === undefined
        ? { id: [msg as string], prefixes: [], unitScale: 1, units: '' }
        : { id: [msg as string, axis as 'R' | 'P' | 'Y'], prefixes: [], unitScale: 1, units: '' }
    return [key, specLabel(spec)]
  })
)

/** Next power of two above or below `current`, depending on which way the user stepped. */
export function stepPowerOfTwo(current: number, previous: number): number {
  if (current > previous) return 2 ** Math.ceil(Math.log2(Math.max(current, 2)))
  return Math.max(2, 2 ** Math.floor(Math.log2(Math.max(current, 2))))
}

/** FFT settings, analysis time range, controller selection, file input and calculate button. */
export function SetupPanel(p: SetupPanelProps) {
  const available = new Set(p.availableSpecs.map(specKey))
  return (
    <fieldset style={{ width: 1100, marginLeft: 30 }}>
      <legend>Setup</legend>
      <div className="apwt-row">
        <fieldset style={{ width: 200, height: 80 }}>
          <legend>FFT Settings</legend>
          <label>
            Window size{' '}
            <input
              type="number"
              min={2}
              step={1}
              value={p.windowSize}
              style={{ width: 60 }}
              onChange={(e) => p.onWindowSizeChange(stepPowerOfTwo(Number(e.target.value), p.windowSize))}
            />
          </label>
        </fieldset>

        <fieldset style={{ width: 200, height: 80 }}>
          <legend>Analysis time</legend>
          <label>
            Start (s){' '}
            <input
              type="number"
              step={1}
              disabled={p.timeLimits == null}
              min={p.timeLimits?.[0]}
              max={p.timeLimits?.[1]}
              value={p.timeRange[0]}
              style={{ width: 60 }}
              onChange={(e) => p.onTimeRangeChange([Number(e.target.value), p.timeRange[1]])}
            />
          </label>
          <br />
          <br />
          <label>
            End (s){' '}
            <input
              type="number"
              step={1}
              disabled={p.timeLimits == null}
              min={p.timeLimits?.[0]}
              max={p.timeLimits?.[1]}
              value={p.timeRange[1]}
              style={{ width: 60 }}
              onChange={(e) => p.onTimeRangeChange([p.timeRange[0], Number(e.target.value)])}
            />
          </label>
        </fieldset>

        <fieldset style={{ width: 330, height: 80 }}>
          <legend>Axis</legend>
          <div className="apwt-row">
            {SPEC_COLUMNS.map((column, i) => (
              <div key={i}>
                {column.map((key) => (
                  <label key={key} style={{ display: 'block' }}>
                    <input
                      type="radio"
                      name="axis"
                      disabled={!available.has(key)}
                      checked={p.selectedSpecKey === key}
                      onChange={() => p.onSelectSpec(key)}
                    />{' '}
                    {SPEC_LABELS[key]}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>

        <div>
          <input
            type="file"
            accept=".bin"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) p.onFile(f)
            }}
          />
          <br />
          <br />
          <OpenInButton file={p.file} messageTypes={p.messageTypes} />
          <br />
          <br />
          <button type="button" disabled={!p.calculateEnabled} onClick={p.onCalculate}>
            Calculate
          </button>
        </div>
      </div>
    </fieldset>
  )
}
