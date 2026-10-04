/**
 * Widget palette (upstream `init_pallet`): clicking the empty dashboard while editing is enabled
 * opens a grid of example widgets that can be dragged onto the dashboard.
 */
import { GridStack } from 'gridstack'
import tippy, { followCursor, type Instance } from 'tippy.js'
import { domString, hasKey, jsString, prop } from '../layout/json.js'
import { widgetOf, type Widget } from '../widgets/base.js'
import type { Dashboard } from './dashboard.js'
import { importPaletteFiles, type PaletteFile } from './palette-imports.js'
import attitudeUrl from '../assets/SandBoxWidgets/Attitude.json?url'
import graphUrl from '../assets/SandBoxWidgets/Graph.json?url'
import mapUrl from '../assets/SandBoxWidgets/Map.json?url'
import inspectorUrl from '../assets/SandBoxWidgets/MAVLink_Inspector.json?url'
import messagesUrl from '../assets/SandBoxWidgets/Messages.json?url'
import statsUrl from '../assets/SandBoxWidgets/Stats.json?url'
import valueUrl from '../assets/SandBoxWidgets/Value.json?url'

/** The example widget files and where each goes on the palette. */
export const PALETTE_FILES: readonly PaletteFile[] = [
  { url: attitudeUrl, pos: { x: 1, y: 0, w: 2, h: 2 } },
  { url: graphUrl, pos: { x: 3, y: 0, w: 3, h: 2 } },
  { url: mapUrl, pos: { x: 0, y: 2, w: 2, h: 2 } },
  { url: inspectorUrl, pos: { x: 2, y: 2, w: 2, h: 2 } },
  { url: messagesUrl, pos: { x: 4, y: 2, w: 2, h: 2 } },
  { url: valueUrl, pos: { x: 0, y: 4, w: 1, h: 1 } },
  { url: statsUrl, pos: { x: 3, y: 5, w: 1, h: 1 } }
]

const COLUMNS = 6
const ROWS = 5

/** A palette widget's tip: `about.name` as a heading (`innerText`), then `about.info` if present. */
function aboutTip(widget: Widget): HTMLDivElement {
  const about = widget.about
  const content = document.createElement('div')
  const heading = document.createElement('h6')
  heading.innerText = domString(prop(about, 'name'))
  content.append(heading)
  if (hasKey(about, 'info')) content.append(document.createTextNode(jsString(prop(about, 'info'))))
  return content
}

export function installPalette(dashboard: Dashboard): void {
  const tipDiv = document.createElement('div')
  tipDiv.className = 'td-palette'
  const gridDiv = document.createElement('div')
  gridDiv.classList.add('grid-stack-item-content')
  gridDiv.style.overflow = 'auto'
  tipDiv.append(gridDiv)

  let palette: GridStack | null = null
  let tipShown = false

  const mount = (instance: Instance): void => {
    const grid = GridStack.init(
      { float: true, column: COLUMNS, row: ROWS, cellHeight: `${100 / ROWS}%`, disableResize: true },
      gridDiv
    )
    palette = grid
    grid.batchUpdate(true)
    dashboard.addWidget(grid, { type: 'WidgetSubGrid', x: 0, y: 0, w: 1, h: 1 })
    dashboard.addWidget(grid, { type: 'WidgetSandBox', x: 0, y: 1, w: 1, h: 1 })
    dashboard.addWidget(grid, { type: 'WidgetCustomHTML', x: 1, y: 5, w: 1, h: 1 })

    // A file that fails to load (or parse) is left out; the rest are initialised (proven bug #71).
    const fetchJson = (url: string): Promise<unknown> => fetch(url).then((res) => res.json() as Promise<unknown>)
    void importPaletteFiles(PALETTE_FILES, fetchJson, (widget) => dashboard.addWidget(grid, widget)).then(() => {
      grid.batchUpdate(false)
      const widgets = grid.getGridItems().flatMap((el) => {
        const widget = widgetOf(el)
        return widget === undefined ? [] : [widget]
      })
      for (const widget of widgets) widget.init()
      // A tip on each widget with its name and description.
      for (const widget of widgets)
        tippy(widget.el, { content: aboutTip(widget), appendTo: () => document.body, theme: 'light-border' })
    })

    grid.on('removed', () => {
      // A widget was dragged out: close the palette; it is rebuilt next time.
      instance.hide()
      tipShown = false
    })
  }

  const tip = tippy(dashboard.element, {
    content: tipDiv,
    interactive: true,
    trigger: 'manual',
    maxWidth: '1000px',
    followCursor: 'initial',
    plugins: [followCursor],
    appendTo: () => document.body,
    onMount: mount,
    onHidden: () => {
      dashboard.clearGrid(palette)
      palette = null
    },
    arrow: false
  })

  dashboard.element.addEventListener('click', (event) => {
    if (event.target !== event.currentTarget) {
      // Only direct clicks on the dashboard; resetting the toggle lets a click elsewhere close it.
      tipShown = true
      return
    }
    if (!dashboard.gridEditEnabled(dashboard.grid)) return
    if (!tipShown) {
      // The old palette must be cleared before a new one is built.
      if (palette !== null) return
      tip.show()
    }
    tipShown = !tipShown
  })
}
