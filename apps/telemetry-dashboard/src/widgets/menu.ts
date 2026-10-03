/**
 * Menu widget (upstream Widgets/Menu.js): a small static grid of four icons — ArduPilot link,
 * GitHub link, connection (coloured by link state) and settings — laid out for the widget's
 * aspect ratio. Each menu sets up its own connection when it is initialised.
 */
import { GridStack } from 'gridstack'
import tippy from 'tippy.js'
import type { ConnectionColor } from '../connection/connection.js'
import { domString } from '../layout/json.js'
import { INTERACTIVE_TIP, Widget } from './base.js'
import { framedContent, fullSizeDiv } from './grid-host.js'
import { createConnectionPanel, createSettingsPanel, type MenuHost } from './menu-panels.js'
import { menuOptions, type OptionsObject } from './options.js'
import apSquareUrl from '../assets/AP_Square.png'
import githubMarkUrl from '../assets/github-mark.png'

/** Id upstream gave the settings icon; the unsaved-changes prompt opens the first one in the page. */
export const SETTINGS_ICON_ID = 'MenuSettingsIcon'

const CONNECT_COLOR: Record<ConnectionColor, string> = { black: 'black', orange: 'orange', green: 'green', red: 'red' }

function linkCell(href: string, src: string, size: string, label: string): HTMLDivElement {
  const cell = document.createElement('div')
  const a = document.createElement('a')
  a.href = href
  a.className = 'td-menu-cell'
  a.setAttribute('aria-label', label)
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  img.style.width = size
  img.style.height = size
  img.style.objectFit = 'contain'
  img.style.cursor = 'pointer'
  a.append(img)
  cell.append(a)
  return cell
}

function iconCell(icon: string, label: string): { cell: HTMLDivElement; button: HTMLButtonElement } {
  const cell = document.createElement('div')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'td-menu-cell td-menu-icon'
  button.setAttribute('aria-label', label)
  button.title = label
  const i = document.createElement('i')
  i.className = `fa-solid ${icon}`
  button.append(i)
  cell.append(button)
  return { cell, button }
}

export class MenuWidget extends Widget {
  protected override readonly host: MenuHost
  private readonly widgetDiv: HTMLDivElement
  private readonly sizeDiv: HTMLDivElement
  private grid: GridStack | null

  constructor(rawOptions: unknown, host: MenuHost) {
    super('WidgetMenu', menuOptions(rawOptions), false, host)
    this.host = host
    this.el.classList.add('grid-stack-item', 'grid-stack-draggable-item', 'grid-stack-sub-grid')
    const { widgetDiv, sizeDiv } = framedContent()
    this.widgetDiv = widgetDiv
    this.sizeDiv = sizeDiv
    this.el.append(widgetDiv)
    const gridDiv = fullSizeDiv()
    sizeDiv.append(gridDiv)
    this.grid = GridStack.init({ float: true, staticGrid: true }, gridDiv)
  }

  override init(): void {
    const grid = this.grid
    if (grid === null) return
    grid.addWidget(linkCell('https://ardupilot.org', apSquareUrl, '100%', 'ardupilot.org'))
    grid.addWidget(linkCell('https://github.com/ArduPilot/WebTools', githubMarkUrl, '70%', 'WebTools on GitHub'))

    const connect = iconCell('fa-link', 'Connection')
    grid.addWidget(connect.cell)
    const settings = iconCell('fa-gear', 'Settings')
    settings.button.id = SETTINGS_ICON_ID
    grid.addWidget(settings.cell)

    // Settings popup.
    const settingsPanel = createSettingsPanel(this.host, () => {
      this.changed = true
    })
    const settingsTip = tippy(settings.button, { ...INTERACTIVE_TIP, content: settingsPanel.element, maxWidth: '1000px' })
    settingsPanel.onClose(() => settingsTip.hide())
    settings.button.onclick = () => settingsTip.show()
    this.host.registerSettingsMenu(settings.button, settingsPanel.element, {
      show: () => settingsTip.show(),
      focusSave: () => settingsPanel.focusSave(),
      hide: () => settingsTip.hide(),
      setGridSize: (columns, rows) => settingsPanel.setGridSize(columns, rows)
    })

    // Connection popup and its link.
    const connectIcon = connect.button.querySelector('i')
    const connectionTip = tippy(connect.button, { ...INTERACTIVE_TIP, maxWidth: '1000px' })
    const connectionPanel = createConnectionPanel(this.host, {
      setColor: (color) => {
        if (connectIcon !== null) connectIcon.style.color = CONNECT_COLOR[color]
      },
      show: () => connectionTip.show(),
      hide: () => connectionTip.hide()
    })
    connectionTip.setContent(connectionPanel)
    connect.button.onclick = () => connectionTip.show()

    new ResizeObserver(() => this.updateSize()).observe(this.el)
    this.disableButtonsForEdit()
  }

  /** One row of four (wide), a column (tall) or two by two (square-ish). */
  private updateSize(): void {
    const grid = this.grid
    if (grid === null) return
    const height = this.sizeDiv.clientHeight
    const width = this.sizeDiv.clientWidth
    const maxAr = 1.5
    const minAr = 1 / maxAr
    const ar = height / width
    const columns = ar < minAr ? 4 : ar > maxAr ? 1 : 2
    grid.column(columns)
    grid.cellHeight(`${Math.floor((height * columns) / 4)}px`)
    grid.getGridItems().forEach((el, i) => {
      grid.update(el, { x: i % columns, y: Math.floor(i / columns) })
    })
  }

  override getOptions(): OptionsObject {
    return { form_content: this.getFormContent() }
  }

  override formChanged(): void {
    super.formChanged()
    const options = this.getFormContent()
    this.widgetDiv.style.borderColor = domString(options.borderColor)
    this.widgetDiv.style.backgroundColor = domString(options.backgroundColor)
  }

  override destroy(): void {
    this.grid?.destroy()
    this.grid = null
    super.destroy()
  }
}
