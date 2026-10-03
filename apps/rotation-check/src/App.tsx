import { useMemo, useState } from 'react'
import { PlotlyChart } from '@apwt/plot'
import { Section, ToolPage } from '@apwt/tool-shell'
import { parseEulerDeg, resolveRotation } from './analysis/resolve.js'
import { STANDARD_ROTATIONS, isCustomRotation, type EulerAxis, type EulerDeg, type RotationInfo } from './analysis/rotations.js'
import { MatrixTable, eulerText } from './ui/MatrixPanel.js'
import { Rail } from './ui/Rail.js'
import { usePlotTheme } from './ui/usePlotTheme.js'
import { frameTraces, sceneLayout } from './ui/traces.js'
import './ui/rotation.css'

type AngleText = Readonly<Record<EulerAxis, string>>

function angleText(e: EulerDeg): AngleText {
  return { roll: String(e.roll), pitch: String(e.pitch), yaw: String(e.yaw) }
}

/** Wheel scrolling scrolls the page instead of zooming the scene (upstream zooms). */
const PLOT_CONFIG = { scrollZoom: false } as const

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
  const resolved = useMemo(
    () =>
      isCustomRotation(selected)
        ? resolveRotation({ kind: 'custom', value: selected.value, eulerDeg: parseEulerDeg(customText) })
        : resolveRotation({ kind: 'standard', value: selected.value }),
    [selected, customText]
  )

  const plotTheme = usePlotTheme()
  const layout = useMemo(() => sceneLayout(plotTheme), [plotTheme])
  const traces = useMemo(() => frameTraces(resolved.matrix), [resolved])

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
        />
      }
    >
      <Section
        title="Orientation"
        help="The faded arrows are the reference frame, the solid arrows the rotated one: forward (X) blue, right (Y) red, down (Z) green. Drag to orbit."
      >
        <PlotlyChart className="apwt-plot rc-plot" data={traces} layout={layout} config={PLOT_CONFIG} />
      </Section>

      <Section title="Rotation matrix" help="Each column is a rotated body axis written in the reference frame.">
        <MatrixTable matrix={resolved.matrix} />
        <dl className="apwt-facts rc-facts">
          <div>
            <dt>Parameter value</dt>
            <dd className="rc-param">
              <span>{selected.value}</span>
              <code>ROTATION_{selected.id}</code>
            </dd>
          </div>
          <div>
            <dt>Euler angles</dt>
            <dd>{eulerText(resolved.eulerDeg)}</dd>
          </div>
        </dl>
      </Section>
    </ToolPage>
  )
}
