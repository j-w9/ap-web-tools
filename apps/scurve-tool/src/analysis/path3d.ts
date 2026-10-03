/**
 * Geometry for the 3D flight path plot: axis range, waypoint-radius spheres and the quantity the
 * path is coloured by.
 *
 * Upstream: `get_range`, `generate_plotly_sphere` and the colouring branch of `replot` in
 * `SCurveTool/SCurveTool.js`.
 */
import type { Simulation } from './simulate.js'
import { magnitude } from './simulate.js'
import type { Mission, Waypoint } from './waypoints.js'

/** What the path is coloured by. Upstream uses three mutually exclusive checkboxes, all of which may be off. */
export const COLOUR_BY_OPTIONS = ['velocity', 'acceleration', 'jerk', 'none'] as const
export type ColourBy = (typeof COLOUR_BY_OPTIONS)[number]

export const COLOUR_BY = {
  velocity: { label: 'Velocity', title: 'Vel Magnitude', hoverName: 'Vel', units: 'm/s' },
  acceleration: { label: 'Acceleration', title: 'Accel Magnitude', hoverName: 'Accel', units: 'm/s²' },
  jerk: { label: 'Jerk', title: 'Jerk Magnitude', hoverName: 'Jerk', units: 'm/s³' },
  none: { label: 'None', title: '', hoverName: '', units: '' }
} as const satisfies Record<ColourBy, { label: string; title: string; hoverName: string; units: string }>

/** Magnitude of the chosen quantity at each sample, or `null` for a plain line. */
export function colourValues(sim: Simulation, by: ColourBy): Float64Array | null {
  switch (by) {
    case 'velocity':
      return magnitude(sim.velocity)
    case 'acceleration':
      return magnitude(sim.acceleration)
    case 'jerk':
      return magnitude(sim.jerk)
    case 'none':
      return null
  }
}

/**
 * One range shared by all three axes so the cube aspect shows true proportions: the waypoints'
 * extent padded by the waypoint radius. The pad is applied whether or not the spheres are shown,
 * so the axes do not jump when they are toggled.
 */
export function axisRange(mission: Mission, radiusM: number): [min: number, max: number] {
  let min = Infinity
  let max = -Infinity
  for (const w of mission) {
    min = Math.min(min, w.north, w.east, w.up)
    max = Math.max(max, w.north, w.east, w.up)
  }
  return [min - radiusM, max + radiusM]
}

/** A triangle mesh in Plotly `mesh3d` form: vertices x/y/z, triangles i/j/k. */
export interface Mesh {
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly i: Uint32Array
  readonly j: Uint32Array
  readonly k: Uint32Array
}

/**
 * A sphere of `radius` around `center` (x north, y east, z up). Ported as-is, including the
 * float-accumulated angle loops and upstream's triangle indexing.
 */
export function sphereMesh(center: Waypoint, radius: number, steps: number): Mesh {
  const x: number[] = []
  const y: number[] = []
  const z: number[] = []
  const i: number[] = []
  const j: number[] = []
  const k: number[] = []

  const angleStep = Math.PI / steps
  for (let theta = 0; theta < Math.PI; theta += angleStep) {
    for (let phi = 0; phi < 2 * Math.PI; phi += angleStep) {
      x.push(center.north + radius * Math.sin(theta) * Math.cos(phi))
      y.push(center.east + radius * Math.sin(theta) * Math.sin(phi))
      z.push(center.up + radius * Math.cos(theta))
    }
  }

  for (let m = 0; m < steps - 1; m++) {
    for (let n = 0; n < steps * 2 - 1; n++) {
      const p1 = m * steps * 2 + n
      const p2 = p1 + 1
      const p3 = p1 + steps * 2
      const p4 = p3 + 1
      i.push(p1, p2, p3, p2, p4, p3)
      j.push(p2, p4, p4, p4, p3, p3)
      k.push(p3, p3, p1, p1, p1, p2)
    }
  }

  return {
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    z: Float64Array.from(z),
    i: Uint32Array.from(i),
    j: Uint32Array.from(j),
    k: Uint32Array.from(k)
  }
}
