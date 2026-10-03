import { useId, useRef } from 'react'
import { Download, ExternalLink, Upload } from 'lucide-react'
import { fftWindowSizeInc } from '@apwt/signal'
import { ControlGroup, LogInput, RadioChips, RailCard, type LogFact } from '@apwt/tool-shell'
import { SUPPORTED_FILTER_VERSIONS, type FilterVersion } from '../analysis/filter-version.js'
import type { GyroLogType } from '../analysis/gyro-data.js'
import type { FilterParamName, PageValues } from '../analysis/page-values.js'
import { NotchEditor } from './NotchEditor.js'
import { CommitNumberField, NumberField, TextNumberField } from './NumberField.js'

const VERSION_HELP: Readonly<Record<FilterVersion, string>> = {
  1: 'Original filter implementation.',
  2: 'New strategy when tracking frequencies under the minimum limit. Adds multi-source throttle notch and minimum frequency ratio.',
  3: 'Quintuple (5) notch added but not functional.',
  4: 'Quintuple (5) notch fully functional.'
}

/** FFT inputs as their value strings: window size for raw logs, windows per batch for batch logs. */
export interface FftSettings {
  windowSize: string
  windowsPerBatch: string
}

export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  /** Gyro sources in the log, null before loading. */
  available: { batch: boolean; raw: boolean } | null
  /** Gyro data in use, null before loading. */
  logType: GyroLogType | null
  fft: FftSettings
  onFftChange: (fft: FftSettings) => void
  timeRange: [number, number]
  timeLimits: [number, number] | null
  onTimeRangeChange: (range: [number, number]) => void
  filterVersion: FilterVersion
  onFilterVersionChange: (version: FilterVersion) => void
  values: PageValues
  onValueChange: (name: FilterParamName, value: string | number) => void
  sixteenHarmonics: boolean
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
  // Last committed window size, upstream's `data-last` (starts at the input's default, 1024;
  // values the calculation writes back do not change it)
  const lastWindowSize = useRef(1024)
  const commitWindowSize = (text: string): string => {
    const entered = parseFloat(text)
    const next = fftWindowSizeInc(lastWindowSize.current, entered)
    lastWindowSize.current = next
    return Object.is(next, entered) ? text : String(next)
  }

  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput facts={p.facts} onFile={p.onFile} hint="Needs raw IMU (GYR) or batch sampling (ISBH, ISBD) messages" />
      </ControlGroup>

      <ControlGroup label="Gyro data">
        <RadioChips
          name="log-type"
          value={p.logType ?? 'raw'}
          onChange={() => undefined}
          options={[
            { value: 'raw', label: 'Raw IMU', disabled: true },
            { value: 'batch', label: 'Batch sampling', disabled: true }
          ]}
        />
        <p className="fr-hint">
          {p.available === null
            ? 'Raw IMU data is used whenever the log has it; batch sampling only when there is no raw data.'
            : p.available.raw && p.available.batch
              ? 'This log has both; raw IMU data is used, as in the original tool.'
              : p.logType === 'raw'
                ? 'This log has raw IMU data.'
                : 'This log has batch sampling data.'}
        </p>
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
        <CommitNumberField
          label="Windows per batch"
          step={1}
          min={1}
          disabled={p.logType !== 'batch'}
          value={p.fft.windowsPerBatch}
          onChange={(windowsPerBatch) => p.onFftChange({ ...p.fft, windowsPerBatch })}
        />
        <CommitNumberField
          label="Window size"
          step={1}
          min={1}
          disabled={p.logType !== 'raw'}
          value={p.fft.windowSize}
          commit={commitWindowSize}
          onChange={(windowSize) => p.onFftChange({ ...p.fft, windowSize })}
        />
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
        <TextNumberField
          label="Cut-off (Hz)"
          title="INS_GYRO_FILTER"
          step={0.1}
          disabled={!loaded}
          value={p.values.INS_GYRO_FILTER}
          onChange={(v) => p.onValueChange('INS_GYRO_FILTER', v)}
        />
        <TextNumberField
          label="Loop rate (Hz)"
          title="SCHED_LOOP_RATE, used for aliasing"
          step={1}
          min={25}
          disabled={!loaded}
          value={p.values.SCHED_LOOP_RATE}
          onChange={(v) => p.onValueChange('SCHED_LOOP_RATE', v)}
        />
      </ControlGroup>

      {[0, 1].map((i) => (
        <ControlGroup key={i} label={`Harmonic notch ${i + 1}`}>
          <NotchEditor
            index={i}
            values={p.values}
            onChange={p.onValueChange}
            sixteenHarmonics={p.sixteenHarmonics}
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
        <p className="fr-hint">Changes update the plots straight away; the original tool waited for its Calculate buttons.</p>
      </ControlGroup>
    </RailCard>
  )
}
