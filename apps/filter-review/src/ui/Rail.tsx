import { useId } from 'react'
import { Download, ExternalLink, Upload } from 'lucide-react'
import { stepWindowSize } from '@apwt/signal'
import { ControlGroup, LogInput, RadioChips, RailCard, type LogFact } from '@apwt/tool-shell'
import type { FilterParams, NotchParams } from '../analysis/filter-params.js'
import { SUPPORTED_FILTER_VERSIONS, type FilterVersion } from '../analysis/filter-version.js'
import type { GyroLogType } from '../analysis/gyro-data.js'
import { NotchEditor } from './NotchEditor.js'
import { NumberField } from './NumberField.js'

const VERSION_HELP: Readonly<Record<FilterVersion, string>> = {
  1: 'Original filter implementation.',
  2: 'New strategy when tracking frequencies under the minimum limit. Adds multi-source throttle notch and minimum frequency ratio.',
  3: 'Quintuple (5) notch added but not functional.',
  4: 'Quintuple (5) notch fully functional.'
}

/** FFT settings: window size for raw logs, windows per batch for batch logs. */
export interface FftSettings {
  windowSize: number
  windowsPerBatch: number
}

export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  /** Gyro sources in the log, null before loading. */
  available: { batch: boolean; raw: boolean } | null
  logType: GyroLogType
  onLogTypeChange: (type: GyroLogType) => void
  fft: FftSettings
  onFftChange: (fft: FftSettings) => void
  timeRange: [number, number]
  timeLimits: [number, number] | null
  onTimeRangeChange: (range: [number, number]) => void
  filterVersion: FilterVersion
  onFilterVersionChange: (version: FilterVersion) => void
  params: FilterParams
  onParamsChange: (params: FilterParams) => void
  harmonicCount: number
  availableModes: ReadonlySet<number>
  onSaveParams: () => void
  onLoadParams: (file: File) => void
  /** Result of the last parameter file load. */
  paramMessage: string | null
  filterToolHref: string | null
}

/** The control rail: log, gyro source, analysis window, FFT and every filter parameter. */
export function Rail(p: RailProps) {
  const loaded = p.timeLimits !== null
  const paramFileId = useId()
  const setNotch = (index: number, notch: NotchParams) => {
    const notches: [NotchParams, NotchParams] = [p.params.notches[0], p.params.notches[1]]
    notches[index] = notch
    p.onParamsChange({ ...p.params, notches })
  }

  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput facts={p.facts} onFile={p.onFile} hint="Needs raw IMU (GYR) or batch sampling (ISBH, ISBD) messages" />
      </ControlGroup>

      <ControlGroup label="Gyro data">
        <RadioChips
          name="log-type"
          value={p.logType}
          onChange={p.onLogTypeChange}
          options={[
            { value: 'raw', label: 'Raw IMU', disabled: p.available !== null && !p.available.raw },
            { value: 'batch', label: 'Batch sampling', disabled: p.available !== null && !p.available.batch }
          ]}
        />
        <p className="fr-hint">Used when a log has both. Raw logging gives continuous data; batch logging gives short bursts.</p>
      </ControlGroup>

      <ControlGroup label="Analysis window">
        <NumberField
          label="Start (s)"
          step={1}
          disabled={!loaded}
          value={p.timeRange[0]}
          onChange={(v) => p.onTimeRangeChange([v, p.timeRange[1]])}
        />
        <NumberField
          label="End (s)"
          step={1}
          disabled={!loaded}
          value={p.timeRange[1]}
          onChange={(v) => p.onTimeRangeChange([p.timeRange[0], v])}
        />
        <p className="fr-hint">Or zoom the flight data plot to pick a window.</p>
      </ControlGroup>

      <ControlGroup label="FFT">
        {p.logType === 'raw' ? (
          <label className="apwt-field">
            <span>Window size</span>
            <input
              type="number"
              min={2}
              step={1}
              value={p.fft.windowSize}
              onChange={(e) => {
                const v = Number(e.target.value)
                p.onFftChange({ ...p.fft, windowSize: stepWindowSize(v, v > p.fft.windowSize ? 'up' : 'down') })
              }}
            />
          </label>
        ) : (
          <NumberField
            label="Windows per batch"
            step={1}
            min={1}
            value={p.fft.windowsPerBatch}
            onChange={(v) => p.onFftChange({ ...p.fft, windowsPerBatch: Math.max(1, Math.round(v)) })}
          />
        )}
      </ControlGroup>

      <ControlGroup label="Filter version">
        <RadioChips
          name="filter-version"
          value={String(p.filterVersion) as `${FilterVersion}`}
          onChange={(v) => p.onFilterVersionChange(Number(v) as FilterVersion)}
          options={SUPPORTED_FILTER_VERSIONS.map((v) => ({ value: `${v}` as const, label: `${v}.0` }))}
        />
        <p className="fr-hint">{VERSION_HELP[p.filterVersion]}</p>
      </ControlGroup>

      <ControlGroup label="Low-pass filter">
        <NumberField
          label="Cut-off (Hz)"
          title="INS_GYRO_FILTER"
          step={0.1}
          value={p.params.gyroFilter}
          onChange={(v) => p.onParamsChange({ ...p.params, gyroFilter: v })}
        />
        <NumberField
          label="Loop rate (Hz)"
          title="SCHED_LOOP_RATE, used for aliasing"
          step={1}
          min={25}
          value={p.params.loopRate}
          onChange={(v) => p.onParamsChange({ ...p.params, loopRate: v })}
        />
      </ControlGroup>

      {p.params.notches.map((notch, i) => (
        <ControlGroup key={i} label={`Harmonic notch ${i + 1}`}>
          <NotchEditor
            index={i}
            params={notch}
            onChange={(n) => setNotch(i, n)}
            harmonicCount={p.harmonicCount}
            availableModes={p.availableModes}
            disabled={!loaded}
          />
        </ControlGroup>
      ))}

      <ControlGroup label="Parameters">
        <div className="fr-actions">
          <button type="button" className="apwt-btn apwt-btn--block" disabled={!loaded} onClick={p.onSaveParams}>
            <Download />
            Save .param file
          </button>
          <label htmlFor={paramFileId} className="apwt-btn apwt-btn--block" aria-disabled={!loaded}>
            <input
              id={paramFileId}
              type="file"
              accept=".param,.parm,.txt"
              className="apwt-sr-only"
              disabled={!loaded}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) p.onLoadParams(f)
                e.target.value = ''
              }}
            />
            <Upload />
            Load .param file
          </label>
          {p.filterToolHref !== null ? (
            <a className="apwt-btn apwt-btn--block" href={p.filterToolHref} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open in Filter Tool
            </a>
          ) : (
            <button type="button" className="apwt-btn apwt-btn--block" disabled>
              <ExternalLink />
              Open in Filter Tool
            </button>
          )}
        </div>
        {p.paramMessage && <p className="fr-hint">{p.paramMessage}</p>}
        <p className="fr-hint">Filter changes update the estimate, Bode plot and notch overlays straight away.</p>
      </ControlGroup>
    </RailCard>
  )
}
