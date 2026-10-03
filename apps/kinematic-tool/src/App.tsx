import { useCallback, useEffect, useMemo, useState } from 'react'
import { PlotlyChart, linkAutorangeReset, linkAxisRanges, type PlotlyHTMLElement } from '@apwt/plot'
import { ErrorBanner, Section, ToolPage, useLoading } from '@apwt/tool-shell'
import { COPTER_DEFAULTS, PLANE_DEFAULTS } from './analysis/params.js'
import { DEFAULT_DEMAND, type Vehicle } from './analysis/scenario.js'
import { simulate, type SimulationSettings } from './analysis/simulate.js'
import { Rail, type CopterChoices, type PlaneChoices } from './ui/Rail.js'
import { QUANTITIES, QUANTITY_INFO, quantityPlots, type Quantity } from './ui/traces.js'
import { loadKinematicLibs, type KinematicLibs } from './wasm/load.js'
import './ui/kinematic.css'

const INTRO: Readonly<Record<Vehicle, string>> = {
  copter:
    'The attitude controller limits its demands with a kinematic model of the vehicle: a rate limit, an acceleration limit and a time constant. See how the real ArduPilot shaping code moves a single axis to a new angle or rate, compared with the time-optimal Ruckig trajectory.',
  plane:
    'The ArduPlane attitude controllers limit their demands with a kinematic model of the vehicle: a rate limit, an acceleration limit and a time constant. See how the real ArduPilot shaping code moves a single axis to a new angle or rate, before and after 4.8.'
}

export function App() {
  const { run } = useLoading()
  const [libs, setLibs] = useState<KinematicLibs | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [vehicle, setVehicle] = useState<Vehicle>('copter')
  const [copter, setCopter] = useState<CopterChoices>({
    axis: 'R',
    mode: 'angle',
    demand: DEFAULT_DEMAND,
    params: COPTER_DEFAULTS
  })
  const [plane, setPlane] = useState<PlaneChoices>({ axis: 'R', mode: 'angle', demand: DEFAULT_DEMAND, params: PLANE_DEFAULTS })

  // Fetch and instantiate the ArduPilot and Ruckig WebAssembly once.
  useEffect(() => {
    let live = true
    run(loadKinematicLibs, 'Loading the ArduPilot controllers')
      .then((loaded) => {
        if (live) setLibs(loaded)
      })
      .catch((e: unknown) => {
        if (live) {
          const reason = e instanceof Error ? e.message : String(e)
          setLoadError(`Could not load the simulation code (${reason}). Reload the page to try again.`)
        }
      })
    return () => {
      live = false
    }
  }, [run])

  const settings: SimulationSettings = useMemo(
    () => (vehicle === 'copter' ? { vehicle: 'copter', ...copter } : { vehicle: 'plane', ...plane }),
    [vehicle, copter, plane]
  )
  const result = useMemo(() => (libs ? simulate(libs, settings) : null), [libs, settings])
  const plots = useMemo(() => quantityPlots(result), [result])
  const ruckigError =
    result?.vehicle === 'copter' && !result.minimumTime.ok
      ? `The minimum time trajectory could not be calculated: ${result.minimumTime.message}`
      : null

  // ----- Plot linking: zooming one time axis zooms the others -----
  const [elements, setElements] = useState<Partial<Record<Quantity, PlotlyHTMLElement>>>({})
  const ready = useCallback(
    (q: Quantity) => (el: PlotlyHTMLElement) => setElements((p) => (p[q] === el ? p : { ...p, [q]: el })),
    []
  )
  useEffect(() => {
    const linked = QUANTITIES.map((q) => elements[q])
    if (!linked.every((el) => el !== undefined)) return
    const unlink = [linkAxisRanges(linked.map((element) => ({ element, axis: 'x' }))), linkAutorangeReset(linked)]
    return () => unlink.forEach((u) => u())
  }, [elements])

  return (
    <ToolPage
      title="Kinematic Tool"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/KinematicTool/Readme.md"
      intro={INTRO[vehicle]}
      rail={
        <Rail
          key={vehicle}
          vehicle={vehicle}
          onVehicleChange={setVehicle}
          copter={copter}
          onCopterChange={setCopter}
          plane={plane}
          onPlaneChange={setPlane}
        />
      }
    >
      <ErrorBanner message={loadError} />
      <ErrorBanner message={ruckigError} />
      {QUANTITIES.map((q) => (
        <Section key={q} title={QUANTITY_INFO[q].title} help={QUANTITY_INFO[q].help}>
          <PlotlyChart className="apwt-plot apwt-plot--short" data={plots[q].data} layout={plots[q].layout} onReady={ready(q)} />
        </Section>
      ))}
    </ToolPage>
  )
}
