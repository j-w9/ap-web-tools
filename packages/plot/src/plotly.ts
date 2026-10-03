// Single import point for Plotly so the rest of the codebase never depends on
// the distribution package name. Plotly is loaded eagerly: every tool plots.
import Plotly from 'plotly.js-dist-min'
import './plotly-augment.js'

export type { Data, Layout, Config, PlotData, PlotRelayoutEvent, PlotlyHTMLElement, Shape, Annotations } from 'plotly.js-dist-min'

export { Plotly }

/** Plotly `config` shared by every tool: no logo, no editable chart. */
export const DEFAULT_CONFIG = { displaylogo: false, responsive: true } as const
