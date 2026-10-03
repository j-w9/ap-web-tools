// Imported for its types by plotly.ts, so every program that uses @apwt/plot sees these
// augmentations (an ambient .d.ts is only visible inside this package's own project).
// Plotly plot elements are Node-style event emitters at runtime, but @types/plotly.js only
// declares `on` and `removeAllListeners`. Declare the per-listener removal we rely on.
import type {} from 'plotly.js'

declare module 'plotly.js' {
  // `meta` is a valid trace attribute (referenced in hovertemplates as %{meta}) missing from the typings.
  interface PlotData {
    meta: string | number | readonly (string | number)[]
    // `cone` trace attributes, missing from the typings.
    u: ArrayLike<number>
    v: ArrayLike<number>
    w: ArrayLike<number>
    sizemode: 'scaled' | 'absolute' | 'raw'
    sizeref: number
    anchor: 'tip' | 'tail' | 'cm' | 'center'
  }

  interface PlotlyHTMLElement {
    removeListener(event: 'plotly_relayout', handler: (event: PlotRelayoutEvent) => void): void
  }
}

export {}
