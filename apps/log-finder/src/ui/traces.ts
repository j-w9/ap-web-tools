/** Plotly trace and layout for the flight path plot. */
import { defaultColor, type Data, type Layout } from '@apwt/plot'
import type { FlightPath } from '../analysis/summary.js'

export function flightPathTraces(path: FlightPath): Partial<Data>[] {
  const last = path.northM.length - 1
  return [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Path',
      x: Array.from(path.eastM),
      y: Array.from(path.northM),
      line: { color: defaultColor(0) },
      hovertemplate: '<extra></extra>East %{x:.1f} m<br>North %{y:.1f} m'
    },
    {
      type: 'scatter',
      mode: 'markers',
      name: 'Start and end',
      x: [path.eastM[0] ?? 0, path.eastM[last] ?? 0],
      y: [path.northM[0] ?? 0, path.northM[last] ?? 0],
      text: ['Start', 'End'],
      marker: { size: 9, color: [defaultColor(2), defaultColor(3)] },
      hovertemplate: '<extra></extra>%{text}'
    }
  ]
}

export const FLIGHT_PATH_LAYOUT: Partial<Layout> = {
  margin: { b: 50, l: 60, r: 20, t: 20 },
  showlegend: false,
  xaxis: { title: { text: 'East (m)' }, zeroline: false },
  yaxis: { title: { text: 'North (m)' }, zeroline: false, scaleanchor: 'x', scaleratio: 1 }
}
