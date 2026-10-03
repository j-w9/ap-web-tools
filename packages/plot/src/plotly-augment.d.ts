// Plotly plot elements are Node-style event emitters at runtime, but @types/plotly.js only
// declares `on` and `removeAllListeners`. Declare the per-listener removal we rely on.
import 'plotly.js'

declare module 'plotly.js' {
  interface PlotlyHTMLElement {
    removeListener(event: 'plotly_relayout', handler: (event: PlotRelayoutEvent) => void): void
  }
}
