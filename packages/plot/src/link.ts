import { Plotly, type PlotRelayoutEvent, type PlotlyHTMLElement } from './plotly.js'

/** One axis of one plot that takes part in a range link. */
export interface LinkedAxis {
  element: PlotlyHTMLElement
  /** `'x'` or `'y'`. */
  axis: 'x' | 'y'
  /** Plotly axis index: `''` for the first axis, `'2'` for the second, ... */
  index?: string
}

type RelayoutHandler = (event: PlotRelayoutEvent) => void

/**
 * Remove a relayout listener. `Plotly.purge` (run when a `PlotlyChart` unmounts) deletes the
 * element's emitter methods along with its listeners, so a link torn down after its plot is
 * gone has nothing left to remove.
 */
function off(element: PlotlyHTMLElement, handler: RelayoutHandler): void {
  if (typeof (element as Partial<PlotlyHTMLElement>).removeListener !== 'function') return
  element.removeListener('plotly_relayout', handler)
}

function axisKey(link: LinkedAxis): string {
  return `${link.axis}axis${link.index ?? ''}`
}

/**
 * Keep the ranges of several axes in sync: when the user zooms one, the others follow.
 *
 * Returns a function that removes the listeners. Propagation uses `Plotly.relayout`
 * with an array-valued `range`, which Plotly reports back as `xaxis.range` rather
 * than `xaxis.range[0]`/`[1]`, so the handlers do not re-trigger each other.
 */
export function linkAxisRanges(links: readonly LinkedAxis[]): () => void {
  const handlers: Array<[PlotlyHTMLElement, RelayoutHandler]> = []

  links.forEach((source, sourceIndex) => {
    const key = axisKey(source)
    const lo = `${key}.range[0]`
    const hi = `${key}.range[1]`
    const handler: RelayoutHandler = (event) => {
      const data = event as Record<string, unknown>
      if (data[lo] === undefined || data[hi] === undefined) return
      const range = [data[lo], data[hi]]
      links.forEach((target, targetIndex) => {
        if (targetIndex === sourceIndex) return
        const targetKey = axisKey(target)
        void Plotly.relayout(target.element, {
          [`${targetKey}.range`]: range,
          [`${targetKey}.autorange`]: false
        })
      })
    }
    source.element.on('plotly_relayout', handler)
    handlers.push([source.element, handler])
  })

  return () => {
    for (const [element, handler] of handlers) off(element, handler)
  }
}

const RESET_AXES = ['xaxis', 'yaxis', 'xaxis2', 'yaxis2'] as const

/**
 * When the user double-clicks (autorange) one plot, autorange every linked plot too,
 * skipping axes marked `fixedrange`. Returns a function that removes the listeners.
 */
export function linkAutorangeReset(elements: readonly PlotlyHTMLElement[]): () => void {
  const handlers: Array<[PlotlyHTMLElement, RelayoutHandler]> = []

  elements.forEach((source, sourceIndex) => {
    const handler: RelayoutHandler = (event) => {
      const data = event as Record<string, unknown>
      const reset = RESET_AXES.some((axis) => data[`${axis}.autorange`] === true)
      if (!reset) return
      elements.forEach((target, targetIndex) => {
        if (targetIndex === sourceIndex) return
        const layout = target.layout as Partial<Record<(typeof RESET_AXES)[number], { fixedrange?: boolean }>>
        const update: Record<string, boolean> = {}
        for (const axis of RESET_AXES) {
          const ax = layout[axis]
          if (ax && !ax.fixedrange) update[`${axis}.autorange`] = true
        }
        if (Object.keys(update).length > 0) void Plotly.relayout(target, update)
      })
    }
    source.on('plotly_relayout', handler)
    handlers.push([source, handler])
  })

  return () => {
    for (const [element, handler] of handlers) off(element, handler)
  }
}

/** Extract an x-axis range from a relayout event, whichever of Plotly's spellings it used. */
export function relayoutRange(event: PlotRelayoutEvent, axis = 'xaxis'): [number, number] | 'autorange' | undefined {
  const data = event as Record<string, unknown>
  const whole = data[`${axis}.range`]
  if (Array.isArray(whole) && whole.length === 2) return [Number(whole[0]), Number(whole[1])]
  const lo = data[`${axis}.range[0]`]
  const hi = data[`${axis}.range[1]`]
  if (lo !== undefined && hi !== undefined) return [Number(lo), Number(hi)]
  if (data[`${axis}.autorange`] === true) return 'autorange'
  return undefined
}
