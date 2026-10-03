import { useMemo, useState } from 'react'
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
import { paramToString } from '@apwt/ardupilot'
import { Table } from './common.js'

type Base = 'all' | 'changed'

const SECTIONS = [...new Set(PARAM_GROUPS.map((g) => g.section))]

/** Parameter downloads: all, changed from default, and the minimal configuration. */
export function ParamExportSection({ params, fileName }: { params: ParamData; fileName: string | null }) {
  const haveDefaults = params.defaults.size > 0
  const [chosenBase, setBase] = useState<Base>('changed')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const base: Base = haveDefaults ? chosenBase : 'all'
  const changedOnly = base === 'changed'

  const present = useMemo(
    () => new Map(PARAM_GROUPS.map((g) => [g.id, presentGroupParams(g, params.values, params.defaults, changedOnly)])),
    [params, changedOnly]
  )
  // Groups with nothing to include are disabled and never selected.
  const included = useMemo(() => new Set([...chosen].filter((id) => (present.get(id)?.length ?? 0) > 0)), [chosen, present])

  if (params.values.size === 0) return null
  const name = (suffix: string): string => exportFileName(fileName ?? undefined, suffix)

  return (
    <Section
      title="Parameter export"
      help="Download the parameters as a .param file for Mission Planner, QGroundControl or MAVProxy."
    >
      <div className="apwt-chips">
        <button type="button" className="apwt-btn" onClick={() => downloadText(name('.param'), allParamsText(params.values))}>
          <Download />
          All parameters
        </button>
        {haveDefaults && (
          <button
            type="button"
            className="apwt-btn"
            title="Only parameters that differ from their firmware default"
            onClick={() => downloadText(name('_changed.param'), changedParamsText(params.values, params.defaults))}
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
      <div className="apwt-section__tools" style={{ margin: '10px 0' }}>
        <ChipLabel>Start from</ChipLabel>
        <RadioChips
          name="param-base"
          value={base}
          onChange={setBase}
          options={[
            { value: 'all', label: 'All parameters' },
            { value: 'changed', label: 'Changed from defaults', disabled: !haveDefaults }
          ]}
        />
      </div>
      {SECTIONS.map((section) => (
        <div key={section} className="apwt-section__tools" style={{ margin: '6px 0', justifyContent: 'flex-start' }}>
          <ChipLabel>{section}</ChipLabel>
          <CheckChips
            value={included}
            onChange={setChosen}
            options={PARAM_GROUPS.filter((g) => g.section === section).map((g) => {
              const list = present.get(g.id) ?? []
              return { value: g.id, label: g.label, disabled: list.length === 0, title: list.join(', ') }
            })}
          />
        </div>
      ))}
      <button
        type="button"
        className="apwt-btn apwt-btn--primary"
        style={{ marginTop: 12 }}
        onClick={() =>
          downloadText(
            name('_minimal.param'),
            minimalParamsText(params.values, params.defaults, { changedOnly, includedGroups: included })
          )
        }
      >
        <Download />
        Minimal parameters
      </button>
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
          <summary style={{ fontFamily: 'var(--mono)' }}>
            {c.name} ({c.changes.length - 1} {c.changes.length === 2 ? 'change' : 'changes'})
          </summary>
          <div style={{ margin: '6px 0 10px' }}>
            <Table head={['Time (s)', 'Value']}>
              {c.changes.map((ch, i) => (
                <tr key={i}>
                  <td>{ch.time.toFixed(2)}</td>
                  <td>{paramToString(ch.value)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      ))}
    </Section>
  )
}
