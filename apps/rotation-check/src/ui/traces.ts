import type { Layout, PlotData, PlotTheme } from '@apwt/plot'
import type { Matrix3, Vector3 } from '../analysis/matrix3.js'
import { BODY_AXES, ORIGIN_SIZE, ROTATED_AXIS_LENGTH, rotatedAxis, type BodyAxis } from '../analysis/resolve.js'
import { IDENTITY } from '../analysis/matrix3.js'

/** Upstream colours: forward blue, right red, down green. */
const AXIS_RGB: Readonly<Record<BodyAxis, string>> = { x: '0,0,255', y: '255,0,0', z: '0,255,0' }
export const AXIS_NAMES: Readonly<Record<BodyAxis, string>> = { x: 'X forward', y: 'Y right', z: 'Z down' }

export function axisColor(axis: BodyAxis, alpha = 1): string {
  return `rgba(${AXIS_RGB[axis]},${alpha})`
}

/** Cone size relative to the vector it sits on (upstream `cone_size`, Plotly `sizemode: 'raw'`). */
const CONE_SIZE = ORIGIN_SIZE * 2.0
/** Half-width of each scene axis (upstream `range`). */
const RANGE = 0.3

/** One axis arrow: a line from the origin and a cone at its tip, as upstream draws them. */
function arrow(tip: Vector3, color: string, legend: { name: string; group: string; show: boolean }): Partial<PlotData>[] {
  return [
    {
      type: 'cone',
      x: [tip.x],
      y: [tip.y],
      z: [tip.z],
      u: [tip.x],
      v: [tip.y],
      w: [tip.z],
      sizemode: 'raw',
      sizeref: CONE_SIZE,
      showscale: false,
      hoverinfo: 'none',
      colorscale: [
        [0, color],
        [1, color]
      ],
      legendgroup: legend.group
    },
    {
      type: 'scatter3d',
      mode: 'lines',
      x: [0, tip.x],
      y: [0, tip.y],
      z: [0, tip.z],
      name: legend.name,
      legendgroup: legend.group,
      showlegend: legend.show,
      hoverinfo: 'none',
      line: { color, width: 10 }
    }
  ]
}

/** The faded reference frame and the solid rotated frame. */
export function frameTraces(matrix: Matrix3): Partial<PlotData>[] {
  const reference = BODY_AXES.flatMap((axis) =>
    arrow(rotatedAxis(IDENTITY, axis, ORIGIN_SIZE), axisColor(axis, 0.5), {
      name: 'Reference frame',
      group: 'reference',
      show: axis === 'x'
    })
  )
  const rotated = BODY_AXES.flatMap((axis) =>
    arrow(rotatedAxis(matrix, axis, ROTATED_AXIS_LENGTH), axisColor(axis), { name: AXIS_NAMES[axis], group: axis, show: true })
  )
  return [...reference, ...rotated]
}

/**
 * Upstream's scene: forward, right, down axes with Y and Z reversed so the view reads as NED,
 * seen from behind and above. `uirevision` keeps the user's camera when the rotation changes.
 */
export function sceneLayout(theme: PlotTheme): Partial<Layout> {
  const axis = (title: string, range: [number, number]) => ({
    title: { text: title },
    range,
    zeroline: false,
    showline: true,
    mirror: true,
    showspikes: false,
    color: theme.muted,
    gridcolor: theme.grid,
    linecolor: theme.line,
    backgroundcolor: 'rgba(0,0,0,0)'
  })
  return {
    scene: {
      xaxis: axis('X, forward', [-RANGE, RANGE]),
      yaxis: axis('Y, right', [RANGE, -RANGE]),
      zaxis: axis('Z, down', [RANGE, -RANGE]),
      aspectratio: { x: 0.75, y: 0.75, z: 0.75 },
      // Upstream's view direction (eye -1.25, 1.25, 1.25) from 1.2 times further out, so the axis
      // titles are not cut off when the card is narrow.
      camera: { eye: { x: -1.5, y: 1.5, z: 1.5 } },
      // Room for the legend above the scene.
      domain: { x: [0, 1], y: [0, 0.9] }
    },
    uirevision: 'rotation-check',
    showlegend: true,
    // Legend across the top, so the scene keeps the card width on narrow screens.
    legend: { itemclick: false, itemdoubleclick: false, orientation: 'h', x: 0, xanchor: 'left', y: 1, yanchor: 'top' },
    margin: { b: 10, l: 10, r: 10, t: 10 }
  }
}
