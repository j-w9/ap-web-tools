import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PlotlyChart, linkAutorangeReset, linkAxisRanges, type PlotlyHTMLElement } from '@apwt/plot'
import {
  Chip,
  ChipLabel,
  ErrorBanner,
  RadioChips,
  Section,
  ToolPage,
  toolById,
  toolReadme,
  useLatest,
  useLoading
} from '@apwt/tool-shell'
import { CURVE_KEYS, type CurveKey, type WpNavEngine } from './analysis/engine.js'
import { COLOUR_BY, COLOUR_BY_OPTIONS, axisRange, type ColourBy } from './analysis/path3d.js'
import { DEFAULT_PARAMS, PARAMS, type ParamValues } from './analysis/params.js'
import { MAX_TIME, simulateMission, type Simulation } from './analysis/simulate.js'
import { DEFAULT_MISSION, withWaypointValue, type Mission } from './analysis/waypoints.js'
import { ParamRail } from './ui/ParamRail.js'
import { curveLayout, curveTraces, pathLayout, pathTraces, radiusTraces } from './ui/traces.js'
import { WaypointTable } from './ui/WaypointTable.js'
import { loadWpNav } from './wasm/wpnav.js'
import './ui/scurve.css'

/** Everything the simulation depends on. */
interface Inputs {
  readonly mission: Mission
  readonly params: ParamValues
}

type EngineState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly engine: WpNavEngine }
  | { readonly status: 'failed'; readonly message: string }

/** A simulation result together with the inputs that produced it. */
interface Simulated {
  readonly inputs: Inputs
  readonly result: Simulation
}

const DEFAULT_INPUTS: Inputs = { mission: DEFAULT_MISSION, params: DEFAULT_PARAMS }

const COLOUR_OPTIONS = COLOUR_BY_OPTIONS.map((value) => ({ value, label: COLOUR_BY[value].label }))

const CURVE_LAYOUTS: Readonly<Record<CurveKey, ReturnType<typeof curveLayout>>> = {
  pos: curveLayout('pos'),
  vel: curveLayout('vel'),
  accel: curveLayout('accel'),
  jerk: curveLayout('jerk'),
  snap: curveLayout('snap')
}

const NARROW = '(max-width: 560px)'

/** Whether the page is phone width, following window resizes. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(NARROW)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(NARROW).matches
  )
}

function isDefault(params: ParamValues): boolean {
  return PARAMS.every((p) => params[p.name] === DEFAULT_PARAMS[p.name])
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function App() {
  const { run } = useLoading()
  const tool = toolById('scurve-tool')

  const [engineState, setEngineState] = useState<EngineState>({ status: 'loading' })
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS)
  const [simulated, setSimulated] = useState<Simulated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [colourBy, setColourBy] = useState<ColourBy>('velocity')
  const [showRadius, setShowRadius] = useState(false)

  // ----- Simulation: rerun whenever an input is committed -----
  const simulate = useCallback(
    (engine: WpNavEngine, next: Inputs) =>
      run(() => {
        try {
          setSimulated({ inputs: next, result: simulateMission(engine, next.mission, next.params) })
          setError(null)
        } catch (e) {
          setError(`The simulation failed: ${message(e)}. Check the waypoints and parameters.`)
        }
      }, 'Simulating'),
    [run]
  )

  const latestInputs = useLatest(inputs)
  useEffect(() => {
    let live = true
    loadWpNav().then(
      (engine) => {
        if (!live) return
        setEngineState({ status: 'ready', engine })
        void simulate(engine, latestInputs.current)
      },
      (e: unknown) => {
        if (live) setEngineState({ status: 'failed', message: message(e) })
      }
    )
    return () => {
      live = false
    }
  }, [simulate, latestInputs])

  const update = (next: Inputs) => {
    setInputs(next)
    if (engineState.status === 'ready') void simulate(engineState.engine, next)
  }

  // ----- Plot data -----
  const sim = simulated?.result ?? null
  const simInputs = simulated?.inputs ?? null
  const radiusM = simInputs?.params.WP_RADIUS_M ?? 0
  const path = useMemo(() => (sim && simInputs ? pathTraces(simInputs.mission, sim, colourBy) : []), [sim, simInputs, colourBy])
  const spheres = useMemo(
    () => (showRadius && simInputs ? radiusTraces(simInputs.mission, simInputs.params.WP_RADIUS_M) : []),
    [showRadius, simInputs]
  )
  const pathData = useMemo(() => [...path, ...spheres], [path, spheres])
  const narrow = useNarrow()
  const layout3d = useMemo(
    () => pathLayout(axisRange(simInputs?.mission ?? inputs.mission, radiusM), narrow),
    [simInputs, inputs, radiusM, narrow]
  )
  const curveData = useMemo((): Readonly<Record<CurveKey, ReturnType<typeof curveTraces>>> => {
    const legs = sim?.legs ?? []
    return {
      pos: curveTraces(legs, 'pos'),
      vel: curveTraces(legs, 'vel'),
      accel: curveTraces(legs, 'accel'),
      jerk: curveTraces(legs, 'jerk'),
      snap: curveTraces(legs, 'snap')
    }
  }, [sim])

  // ----- Link the time axes of the 1D plots -----
  const [plots, setPlots] = useState<Partial<Record<CurveKey, PlotlyHTMLElement>>>({})
  const ready = useCallback(
    (key: CurveKey) => (el: PlotlyHTMLElement) => setPlots((p) => (p[key] === el ? p : { ...p, [key]: el })),
    []
  )
  useEffect(() => {
    const elements = CURVE_KEYS.map((k) => plots[k]).filter((el) => el !== undefined)
    if (elements.length !== CURVE_KEYS.length) return
    const unlink = [linkAxisRanges(elements.map((element) => ({ element, axis: 'x' }))), linkAutorangeReset(elements)]
    return () => unlink.forEach((u) => u())
  }, [plots])

  const duration = sim ? sim.time[sim.time.length - 1] : undefined
  const placeholder =
    engineState.status === 'failed' ? null : <div className="apwt-empty">Loading ArduPilot's waypoint navigation code…</div>

  return (
    <ToolPage
      title="S-Curve Tool"
      readmeUrl={toolReadme(tool)}
      intro={
        <>
          See the S-curve trajectory ArduPilot's waypoint navigation plans through a four-waypoint mission. The path comes from
          the real <code>AC_WPNav</code> code compiled to WebAssembly, run at Copter's 400 Hz with the limits set in the
          parameters.
        </>
      }
      rail={
        <ParamRail
          values={inputs.params}
          onChange={(name, value) => update({ ...inputs, params: { ...inputs.params, [name]: value } })}
          onReset={() => update({ ...inputs, params: DEFAULT_PARAMS })}
          resetDisabled={isDefault(inputs.params)}
        />
      }
    >
      <ErrorBanner
        message={
          engineState.status === 'failed'
            ? `Could not load the WPNav WebAssembly module: ${engineState.message}. Reload the page to try again.`
            : error
        }
      />

      <Section title="Waypoints" help="The vehicle starts at position 1 and flies through positions 2 and 3 to stop at 4.">
        <WaypointTable
          mission={inputs.mission}
          onChange={(index, axis, value) => update({ ...inputs, mission: withWaypointValue(inputs.mission, index, axis, value) })}
        />
      </Section>

      <Section
        title="3D flight path"
        help={
          duration !== undefined
            ? `Target position along the mission, ${duration.toFixed(1)} s from start to finish.`
            : 'Target position along the mission.'
        }
        tools={
          <>
            <ChipLabel>Colour by</ChipLabel>
            <RadioChips name="colour-by" options={COLOUR_OPTIONS} value={colourBy} onChange={setColourBy} />
            <Chip
              type="checkbox"
              checked={showRadius}
              onChange={setShowRadius}
              title="Spheres of WP_RADIUS_M around each waypoint"
            >
              Waypoint radius
            </Chip>
          </>
        }
      >
        {sim && !sim.completed && (
          <p className="scurve-note">
            The vehicle did not reach position 4 within {MAX_TIME} s of simulated time, so the path stops there.
          </p>
        )}
        {sim ? <PlotlyChart className="scurve-plot3d" data={pathData} layout={layout3d} /> : placeholder}
      </Section>

      <Section
        title="1D S-curves"
        help="The S-curve WPNav computes along the track of each leg. Zoom one plot and the others follow."
      >
        {sim
          ? CURVE_KEYS.map((key) => (
              <PlotlyChart
                key={key}
                className="apwt-plot apwt-plot--short"
                data={curveData[key]}
                layout={CURVE_LAYOUTS[key]}
                onReady={ready(key)}
              />
            ))
          : placeholder}
      </Section>
    </ToolPage>
  )
}
