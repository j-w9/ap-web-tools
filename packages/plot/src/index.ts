/**
 * @apwt/plot — typed Plotly wrappers shared by every tool.
 *
 * - `PlotlyChart`: React component driven by immutable `data`/`layout` props.
 * - `linkAxisRanges` / `linkAutorangeReset`: keep several plots' zoom in step.
 * - `defaultColor`: Plotly's default colour cycle, for colouring things outside plots.
 */
export { Plotly, DEFAULT_CONFIG } from './plotly.js'
export type { Data, Layout, Config, PlotData, PlotRelayoutEvent, PlotlyHTMLElement, Shape, Annotations } from './plotly.js'
export { DEFAULT_COLORS, defaultColor, withAlpha } from './colors.js'
export { linkAxisRanges, linkAutorangeReset, relayoutRange, type LinkedAxis } from './link.js'
export { PlotlyChart, type PlotlyChartProps } from './PlotlyChart.js'
