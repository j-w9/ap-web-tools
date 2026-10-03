import { useMemo, useState } from 'react'
import { PlotlyChart } from '@apwt/plot'
import { ErrorBanner, Section, ToolPage } from '@apwt/tool-shell'
import {
  findStandardRotations,
  parseEulerDeg,
  recoveredEulerDeg,
  resolveRotation,
  type ResolvedRotation
} from './analysis/resolve.js'
import {
  EULER_AXES,
  STANDARD_ROTATIONS,
  isCustomRotation,
  type EulerAxis,
  type EulerDeg,
  type RotationInfo
} from './analysis/rotations.js'
import { MatchList, MatrixTable, eulerText } from './ui/MatrixPanel.js'
import { Rail } from './ui/Rail.js'
import { usePlotTheme } from './ui/usePlotTheme.js'
import { frameTraces, sceneLayout } from './ui/traces.js'

type AngleText = Readonly<Record<EulerAxis, string>>

function angleText(e: EulerDeg): AngleText {
  return { roll: String(e.roll), pitch: String(e.pitch), yaw: String(e.yaw) }
}

/** Wheel scrolling scrolls the page instead of zooming the scene (upstream zooms). */
const PLOT_CONFIG = { scrollZoom: false } as const

const NO_INVALID: ReadonlySet<EulerAxis> = new Set()

export function App() {
  const [selected, setSelected] = useState<RotationInfo>(STANDARD_ROTATIONS[0])
  const [search, setSearch] = useState('')
  /** What the user typed for custom rotations; seeded from the last standard rotation, as upstream. */
  const [customText, setCustomText] = useState<AngleText>(angleText(STANDARD_ROTATIONS[0].eulerDeg))

  const select = (next: RotationInfo) => {
    if (isCustomRotation(next) && !isCustomRotation(selected)) setCustomText(angleText(selected.eulerDeg))
    setSelected(next)
  }

  const custom = isCustomRotation(selected)
  const parsed = useMemo(() => (custom ? parseEulerDeg(customText) : null), [custom, customText])
  const invalidAxes = parsed?.ok === false ? new Set(parsed.invalid) : NO_INVALID

  const resolved: ResolvedRotation | null = useMemo(() => {
    if (!isCustomRotation(selected)) return resolveRotation({ kind: 'standard', value: selected.value })
    return parsed?.ok ? resolveRotation({ kind: 'custom', value: selected.value, eulerDeg: parsed.eulerDeg }) : null
  }, [selected, parsed])
  const matches = useMemo(() => (resolved && custom ? findStandardRotations(resolved.matrix) : []), [resolved, custom])

  const plotTheme = usePlotTheme()
  const layout = useMemo(() => sceneLayout(plotTheme), [plotTheme])
  const traces = useMemo(() => (resolved ? frameTraces(resolved.matrix) : null), [resolved])

  const error =
    invalidAxes.size > 0
      ? `Enter a number for ${EULER_AXES.filter((a) => invalidAxes.has(a)).join(', ')} to show the custom rotation.`
      : null

  return (
    <ToolPage
      title="Rotation Check"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/RotationCheck/Readme.md"
      intro={
        <>
          See what ArduPilot&apos;s standard rotations do, as used by <code>AHRS_ORIENTATION</code>, <code>COMPASS_ORIENT</code>{' '}
          and other sensor orientation parameters. Pick Custom 1 or Custom 2 to enter Euler angles yourself. Rotations are
          intrinsic in 321 order; see{' '}
          <a href="https://github.com/ArduPilot/Datasheets/blob/main/References/EulerAngles.pdf">
            Computing Euler Angles from Direction Cosines
          </a>{' '}
          by William Premerlani.
        </>
      }
      rail={
        <Rail
          selected={selected}
          onSelect={select}
          search={search}
          onSearchChange={setSearch}
          angleText={custom ? customText : angleText(selected.eulerDeg)}
          onAngleChange={(axis, text) => setCustomText({ ...customText, [axis]: text })}
          invalidAxes={invalidAxes}
        />
      }
    >
      <ErrorBanner message={error} />

      <Section
        title="Orientation"
        help="The faded arrows are the reference frame, the solid arrows the rotated one: forward (X) blue, right (Y) red, down (Z) green. Drag to orbit."
      >
        {traces ? (
          <PlotlyChart className="apwt-plot" style={{ height: 640 }} data={traces} layout={layout} config={PLOT_CONFIG} />
        ) : (
          <div className="apwt-empty">Enter all three angles to see the rotation.</div>
        )}
      </Section>

      <Section title="Rotation matrix" help="Each column is a rotated body axis written in the reference frame.">
        {resolved && <MatrixTable matrix={resolved.matrix} />}
        <dl className="apwt-facts" style={{ marginTop: 16 }}>
          <div>
            <dt>Parameter value</dt>
            <dd>
              {selected.value} (<code>ROTATION_{selected.id}</code>)
            </dd>
          </div>
          {resolved && (
            <>
              <div>
                <dt>Euler angles</dt>
                <dd>{eulerText(resolved.eulerDeg)}</dd>
              </div>
              <div>
                <dt>Euler angles recovered from the matrix</dt>
                <dd>{eulerText(recoveredEulerDeg(resolved.matrix))}</dd>
              </div>
            </>
          )}
          {resolved && custom && (
            <div>
              <dt>Matching standard rotation</dt>
              <dd>
                <MatchList matches={matches} onSelect={select} />
              </dd>
            </div>
          )}
        </dl>
      </Section>
    </ToolPage>
  )
}
