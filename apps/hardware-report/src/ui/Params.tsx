import { Fragment, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { CheckChips, ChipLabel, RadioChips, Section, downloadText } from '@apwt/tool-shell'
import {
  PARAM_GROUPS,
  allParamsText,
  changedParamsText,
  exportFileName,
  minimalParamsText,
  presentGroupParams
} from '../analysis/minimal-params.js'
import type { ParamData, ParamHistory } from '../analysis/params.js'
import { Table } from './common.js'

type Base = 'all' | 'changed'

const SECTIONS = [...new Set(PARAM_GROUPS.map((g) => g.section))]

/** Parameters present in each group (upstream `update_minimal_config()`). */
function groupPresence(params: ParamData, changedOnly: boolean): Map<string, string[]> {
  return new Map(PARAM_GROUPS.map((g) => [g.id, presentGroupParams(g, params.values, params.defaults, changedOnly)]))
}

/** Parameter downloads: all, changed from default, and the minimal configuration. */
export function ParamExportSection({ params, fileName }: { params: ParamData; fileName: string | null }) {
  const haveDefaults = params.defaults.size > 0
  const [chosenBase, setBase] = useState<Base>('changed')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadedParams, setLoadedParams] = useState(params)
  const base: Base = haveDefaults ? chosenBase : 'all'
  const changedOnly = base === 'changed'

  const present = useMemo(() => groupPresence(params, changedOnly), [params, changedOnly])
  const prune = (groups: ReadonlySet<string>, presence: ReadonlyMap<string, readonly string[]>): Set<string> =>
    new Set([...groups].filter((id) => (presence.get(id)?.length ?? 0) > 0))

  // A new file: upstream `reset()` selects "Changed from defaults" when the log has defaults, and
  // `update_minimal_config()` unticks the groups that are empty for it. Ticks otherwise carry over
  // from the previous file, as upstream never clears them.
  if (loadedParams !== params) {
    setLoadedParams(params)
    setBase('changed')
    setChosen(prune(chosen, groupPresence(params, params.defaults.size > 0)))
  }
  const included = useMemo(() => prune(chosen, present), [chosen, present])

  // Changing the base also runs `update_minimal_config()`: groups left empty are unticked and stay
  // unticked if the base is changed back.
  const changeBase = (next: Base): void => {
    setChosen(prune(included, groupPresence(params, next === 'changed')))
    setBase(next)
  }

  if (params.values.size === 0) return null
  const name = (suffix: string): string => exportFileName(fileName ?? undefined, suffix)
  // Writing fails like upstream's param_to_string for values that are not numbers (e.g. a
  // parameter file line `NAME,` reads as NaN); upstream stops with an error and saves nothing.
  const save = (file: string, text: () => string): void => {
    try {
      downloadText(file, text())
      setSaveError(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Section
      title="Parameter export"
      help="Download the parameters as a .param file for Mission Planner, QGroundControl or MAVProxy."
    >
      <div className="apwt-chips">
        <button type="button" className="apwt-btn" onClick={() => save(name('.param'), () => allParamsText(params.values))}>
          <Download />
          All parameters
        </button>
        {haveDefaults && (
          <button
            type="button"
            className="apwt-btn"
            title="Only parameters that differ from their firmware default"
            onClick={() => save(name('_changed.param'), () => changedParamsText(params.values, params.defaults))}
          >
            <Download />
            Changed parameters
          </button>
        )}
      </div>

      <h3 style={{ margin: '22px 0 4px', fontSize: 15, fontWeight: 600 }}>Minimal configuration</h3>
      <p className="apwt-section__help">
        Configuration without calibrations, IDs, flight modes and the like, for sharing and comparing similar vehicles. Tick the
        groups to include anyway; statistics and read-only values are always left out.
      </p>
      <div className="hr-groups">
        <ChipLabel>Start from</ChipLabel>
        <RadioChips
          name="param-base"
          value={base}
          onChange={changeBase}
          options={[
            { value: 'all', label: 'All parameters' },
            { value: 'changed', label: 'Changed from defaults', disabled: !haveDefaults }
          ]}
        />
        {SECTIONS.map((section) => (
          <Fragment key={section}>
            <ChipLabel>{section}</ChipLabel>
            <CheckChips
              value={included}
              onChange={setChosen}
              options={PARAM_GROUPS.filter((g) => g.section === section).map((g) => {
                const list = present.get(g.id) ?? []
                return { value: g.id, label: g.label, disabled: list.length === 0, title: list.join(', ') }
              })}
            />
          </Fragment>
        ))}
      </div>
      <button
        type="button"
        className="apwt-btn apwt-btn--primary"
        style={{ marginTop: 12 }}
        onClick={() =>
          save(name('_minimal.param'), () =>
            minimalParamsText(params.values, params.defaults, { changedOnly, includedGroups: included })
          )
        }
      >
        <Download />
        Minimal parameters
      </button>
      {saveError !== null && (
        <p role="alert" style={{ color: 'var(--red-text)' }}>
          {saveError}
        </p>
      )}
    </Section>
  )
}

/** Parameters that changed while logging. */
export function ParamChangesSection({ changes }: { changes: readonly ParamHistory[] }) {
  if (changes.length === 0) return null
  return (
    <Section
      title="Parameters changed during logging"
      help="Original value first, then each change. Statistics parameters are not shown."
    >
      {changes.map((c) => (
        <details key={c.name} style={{ marginBottom: 6 }}>
          <summary style={{ fontFamily: 'var(--mono)' }}>{c.name}</summary>
          <div style={{ margin: '6px 0 10px' }}>
            <Table head={['Time (s)', 'Value']} right={[0, 1]} compact>
              {c.changes.map((ch, i) => (
                <tr key={i}>
                  <td>{ch.time.toFixed(2)}</td>
                  <td>{String(ch.value)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      ))}
    </Section>
  )
}
