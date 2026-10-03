/**
 * Plotly traces and layouts for the 3D flight path and the 1D S-curve plots.
 *
 * Upstream: `reset_wp_plot_data`, `initial_load`, `setup_kinematic_plots`, the plotting half of
 * `replot` and `plot_scurves` in `SCurveTool/SCurveTool.js`.
 */
import type { Data, Layout, PlotData } from '@apwt/plot'
import { defaultColor } from '@apwt/plot/colors'
import type { Curve1D, CurveKey } from '../analysis/engine.js'
import { COLOUR_BY, colourValues, sphereMesh, type ColourBy } from '../analysis/path3d.js'
import type { Simulation } from '../analysis/simulate.js'
import type { Mission } from '../analysis/waypoints.js'

/** Upstream's sphere resolution. */
const SPHERE_STEPS = 100
/** Plain path colour when not colouring by a quantity. Upstream draws it black, invisible on the dark theme. */
const PLAIN_PATH_COLOUR = defaultColor(1)

/** Line options of a `scatter3d` trace that the Plotly typings leave out. */
interface ColouredLine extends NonNullable<PlotData['line']> {
  colorscale?: string
  colorbar?: PlotData['colorbar']
  showscale?: boolean
}

/** `mesh3d` options the Plotly typings leave out. */
interface MeshTrace extends Partial<PlotData> {
  color: string
  flatshading: boolean
}

function waypointTrace(mission: Mission): Partial<PlotData> {
  return {
    type: 'scatter3d',
    x: mission.map((w) => w.north),
    y: mission.map((w) => w.east),
    z: mission.map((w) => w.up),
    text: mission.map((_, i) => String(i + 1)),
    name: 'WP',
    mode: 'lines+markers',
    line: { color: defaultColor(0) },
    marker: { color: defaultColor(0), size: 6 },
    hovertemplate: '<extra></extra>WP %{text}<br>N = %{x:.0f} m<br>E = %{y:.0f} m<br>U = %{z:.0f} m'
  }
}

function targetTrace(sim: Simulation, colourBy: ColourBy): Partial<PlotData> {
  const values = colourValues(sim, colourBy)
  const info = COLOUR_BY[colourBy]
  const line: ColouredLine =
    values === null
      ? { width: 10, color: PLAIN_PATH_COLOUR, showscale: false }
      : {
          width: 10,
          color: Array.from(values),
          colorscale: 'Viridis',
          showscale: true,
          // Horizontal under the scene, so the cube keeps the card width on narrow screens.
          colorbar: {
            title: { text: info.title, side: 'top' },
            orientation: 'h',
            len: 0.6,
            thickness: 14,
            x: 0.5,
            xanchor: 'center',
            y: 0,
            yanchor: 'bottom'
          }
        }
  // Upstream's hover labels the north coordinate (x) as E and east (y) as N; fixed here.
  const position = 'N = %{x:.0f} m<br>E = %{y:.0f} m<br>U = %{z:.0f} m'
  return {
    type: 'scatter3d',
    x: sim.position.north,
    y: sim.position.east,
    z: sim.position.down.map((d) => -d),
    name: 'Target',
    mode: 'lines',
    line,
    hovertemplate:
      values === null
        ? `<extra></extra>${position}`
        : `<extra></extra>${position}<br>${info.hoverName} = %{line.color:.2f} ${info.units}`
  }
}

/** A translucent sphere of the waypoint radius around each waypoint. */
export function radiusTraces(mission: Mission, radiusM: number): Partial<Data>[] {
  return mission.map((w) => {
    const mesh = sphereMesh(w, radiusM, SPHERE_STEPS)
    const trace: MeshTrace = {
      type: 'mesh3d',
      ...mesh,
      opacity: 0.3,
      color: 'rgba(255, 0, 0, 0.5)',
      flatshading: true,
      hoverinfo: 'none'
    }
    return trace
  })
}

/** Waypoints and the simulated target path, coloured as chosen. */
export function pathTraces(mission: Mission, sim: Simulation, colourBy: ColourBy): Partial<Data>[] {
  return [waypointTrace(mission), targetTrace(sim, colourBy)]
}

/**
 * The 3D scene: one shared range on every axis with North reversed, as upstream. `narrow` pulls
 * the camera further back so the tick labels fit a phone-width card.
 */
export function pathLayout(range: readonly [number, number], narrow = false): Partial<Layout> {
  const eye = narrow ? 2 : 1.5
  const [min, max] = range
  const axis = (title: string, r: [number, number]) => ({ title: { text: title }, autorange: false, zeroline: false, range: r })
  return {
    legend: { itemclick: false, itemdoubleclick: false, orientation: 'h', x: 0, xanchor: 'left', y: 1, yanchor: 'top' },
    margin: { b: 10, l: 10, r: 10, t: 10 },
    // Keep the user's camera when the path is recomputed (a new default view only when the
    // page crosses phone width).
    uirevision: narrow ? 'flight-path-narrow' : 'flight-path',
    scene: {
      xaxis: axis('North (m)', [max, min]),
      yaxis: axis('East (m)', [min, max]),
      zaxis: axis('Up (m)', [min, max]),
      aspectmode: 'cube',
      // Room for the legend above and the colour bar below.
      domain: { x: [0, 1], y: [0.16, 0.94] },
      // Plotly's default view direction from a little further out, so the cube's corners and
      // tick labels are not cut off.
      camera: { eye: { x: eye, y: eye, z: eye } }
    }
  }
}

/** Title and units of each 1D S-curve plot. */
export const CURVE_PLOTS = {
  pos: { title: 'Position', units: 'm' },
  vel: { title: 'Velocity', units: 'm/s' },
  accel: { title: 'Acceleration', units: 'm/s²' },
  jerk: { title: 'Jerk', units: 'm/s³' },
  snap: { title: 'Snap', units: 'm/s⁴' }
} as const satisfies Record<CurveKey, { title: string; units: string }>

/** One trace per leg of one kinematic quantity. */
export function curveTraces(legs: readonly Curve1D[], key: CurveKey): Partial<Data>[] {
  const { units } = CURVE_PLOTS[key]
  return legs.map((leg, i) => ({
    type: 'scatter',
    x: leg.time,
    y: leg[key],
    name: `Leg ${i + 1}`,
    mode: 'lines',
    line: { color: defaultColor(i) },
    hovertemplate: `<extra></extra>%{x:.2f} s<br>%{y:.2f} ${units}`
  }))
}

export function curveLayout(key: CurveKey): Partial<Layout> {
  const { title, units } = CURVE_PLOTS[key]
  return {
    // Legend above the plot, so the time axis keeps the full card width on narrow screens.
    legend: { itemclick: false, itemdoubleclick: false, orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom' },
    margin: { b: 50, l: 60, r: 20, t: 36 },
    xaxis: { title: { text: 'Time (s)' }, zeroline: false, showline: true, mirror: true },
    yaxis: { title: { text: `${title} (${units})` }, zeroline: false, showline: true, mirror: true },
    showlegend: true
  }
}
