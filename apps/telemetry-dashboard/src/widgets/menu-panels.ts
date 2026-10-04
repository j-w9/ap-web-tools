/**
 * The menu's popups (upstream `settings_tip_template` and `connection_tip_template` in index.html,
 * wired up in Menu.js `init` and TelemetryDashboard.js `setup_connect`).
 */
import tippy from 'tippy.js'
import {
  browserSocketFactory,
  browserTimers,
  ConnectionController,
  type ConnectionColor,
  type ConnectionSettings,
  type MavlinkProcessor
} from '../connection/connection.js'
import type { HashSettings, LinkConnection } from '../layout/link.js'
import type { LegacyMessage } from '../mavlink/legacy-message.js'
import { showMessage } from '../ui/dialogs.js'
import type { GridHost } from './grid-host.js'

/** What the settings popup of the first menu in the page offers to the dashboard. */
export interface SettingsMenu {
  show(): void
  hide(): void
  focusSave(): void
  setGridSize(columns: number, rows: number): void
}

/** Dashboard operations the menu uses. */
export interface MenuHost extends GridHost {
  /** Settings carried in the page's hash when it loaded. */
  readonly hashSettings: HashSettings
  /** The settings icon (upstream id `MenuSettingsIcon`) and popup content (id `settings_tip_div`). */
  registerSettingsMenu(icon: HTMLElement, panel: HTMLElement, menu: SettingsMenu): void
  /** Makes `params` what "Get link" reads (the most recently set up menu wins, as upstream). */
  setConnectionParams(params: () => LinkConnection): void
  setMainGridEdit(enabled: boolean): void
  /** Columns and rows of the main grid. */
  mainGridSize(): { readonly columns: number | undefined; readonly rows: number | undefined }
  setMainGridColumns(columns: number): void
  /** Reloads the main grid with a new row count (upstream: get_layout, change rows, load_layout). */
  setMainGridRows(rows: string): void
  backgroundColor(): string
  setBackgroundColor(color: string): void
  saveLayout(): void
  dashboardLink(): Promise<string>
  loadFile(file: File): void
  /** Publishes a decoded message to the widgets. */
  publish(message: LegacyMessage): void
  /** The page's one MAVLink parser and signing state, shared by every menu's connection. */
  readonly mavlink: MavlinkProcessor
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className !== undefined) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function button(label: string, className = 'apwt-btn'): HTMLButtonElement {
  const b = el('button', className, label)
  b.type = 'button'
  return b
}

function field(label: string, input: HTMLInputElement, extra?: HTMLElement): HTMLLabelElement {
  const wrapper = el('label', 'apwt-field td-field')
  const caption = el('span', 'td-field__label', label)
  if (extra !== undefined) caption.append(' ', extra)
  wrapper.append(caption, input)
  return wrapper
}

function numberInput(value: string, min: string, max: string, step?: string): HTMLInputElement {
  const input = el('input')
  input.type = 'number'
  input.value = value
  input.min = min
  input.max = max
  if (step !== undefined) input.step = step
  return input
}

function checkbox(label: string): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = el('label', 'td-check')
  const input = el('input')
  input.type = 'checkbox'
  row.append(input, el('span', undefined, label))
  return { row, input }
}

function panel(title: string): { element: HTMLDivElement; body: HTMLDivElement; close: HTMLButtonElement } {
  const element = el('div', 'td-tip td-panel')
  const head = el('div', 'td-tip__head')
  const close = button('', 'td-icon-button')
  close.setAttribute('aria-label', 'Close')
  close.append(el('i', 'fa-solid fa-xmark'))
  head.append(el('span', 'td-tip__title', title), close)
  const body = el('div', 'td-panel__body')
  element.append(head, body)
  return { element, body, close }
}

/** Upstream `rgbToHex`: `rgb(r, g, b)` to `#rrggbb` for the colour input. */
export function rgbToHex(rgb: string): string {
  const sep = rgb.includes(',') ? ',' : ' '
  const parts = rgb.substring(4).split(')')[0]!.split(sep)
  const hex = (c: number): string => {
    const h = c.toString(16)
    return h.length === 1 ? '0' + h : h
  }
  return '#' + hex(Number(parts[0])) + hex(Number(parts[1])) + hex(Number(parts[2]))
}

export interface SettingsPanel {
  readonly element: HTMLDivElement
  onClose(handler: () => void): void
  focusSave(): void
  setGridSize(columns: number, rows: number): void
}

/** Save/load, link and dashboard settings. `markChanged` flags the menu as changed. */
/** Id upstream gave the settings popup content; `init_grid` looked it up (found only while shown). */
export const SETTINGS_PANEL_ID = 'settings_tip_div'

export function createSettingsPanel(host: MenuHost, markChanged: () => void): SettingsPanel {
  const { element, body, close } = panel('Settings')
  element.id = SETTINGS_PANEL_ID

  body.append(el('h3', 'td-panel__heading', 'Save and load'))
  const save = button('Save')
  save.onclick = () => host.saveLayout()
  const load = button('Load')
  const loadInput = el('input')
  loadInput.type = 'file'
  loadInput.accept = '.json'
  loadInput.hidden = true
  load.onclick = () => loadInput.click()
  const link = button('Get link')
  link.onclick = () => {
    void host.dashboardLink().then((url) =>
      navigator.clipboard.writeText(url).then(() => {
        link.textContent = 'Copied!'
        setTimeout(() => {
          link.textContent = 'Get link'
        }, 2000)
      })
    )
  }
  const saveRow = el('div', 'td-panel__row')
  saveRow.append(el('span', 'td-field__label', 'Save dashboard'), save)
  const loadRow = el('div', 'td-panel__row')
  loadRow.append(el('span', 'td-field__label', 'Load dashboard or widget'), load, loadInput)
  const linkRow = el('div', 'td-panel__row')
  linkRow.append(el('span', 'td-field__label', 'Get link'), link)
  body.append(saveRow, loadRow, linkRow)

  body.append(el('h3', 'td-panel__heading', 'Dashboard settings'))
  const edit = checkbox('Enable widget edit')
  edit.input.onclick = () => host.setMainGridEdit(edit.input.checked)
  const size = host.mainGridSize()
  const columns = numberInput(String(size.columns), '2', '12', '1')
  columns.onchange = () => {
    host.setMainGridColumns(Number.parseInt(columns.value, 10))
    markChanged()
  }
  const rows = numberInput(String(size.rows), '2', '12', '1')
  rows.onchange = () => {
    host.setMainGridRows(rows.value)
    markChanged()
  }
  const background = el('input')
  background.type = 'color'
  background.value = rgbToHex(host.backgroundColor())
  background.onchange = () => {
    host.setBackgroundColor(background.value)
    markChanged()
  }
  body.append(edit.row, field('Columns', columns), field('Rows', rows), field('Background color', background))

  let closeHandler = (): void => undefined
  close.onclick = () => closeHandler()
  loadInput.onchange = () => {
    closeHandler()
    const file = loadInput.files?.[0]
    if (file !== undefined) host.loadFile(file)
    // Lets the same file be loaded again.
    loadInput.value = ''
  }

  return {
    element,
    onClose: (handler) => {
      closeHandler = handler
    },
    focusSave: () => save.focus(),
    setGridSize: (c, r) => {
      columns.value = String(c)
      rows.value = String(r)
    }
  }
}

export interface ConnectionUi {
  setColor(color: ConnectionColor): void
  show(): void
  hide(): void
}

function helpIcon(html: string): HTMLButtonElement {
  const help = button('', 'td-icon-button td-help')
  help.setAttribute('aria-label', 'Help')
  help.append(el('i', 'fa-regular fa-circle-question'))
  tippy(help, { content: html, allowHTML: true, interactive: true, appendTo: () => document.body, theme: 'light-border' })
  return help
}

const ADDRESS_HELP =
  'Connection address for WebSocket server forwarding raw binary MAVLink. Attempts to auto connect to MissionPlanner at <code>ws://127.0.0.1:56781</code>. Latest PyMAVLink can also be used eg: <a href="https://github.com/IamPete1/pymavlink/blob/WebSocket_forwarding_example/examples/mavtcpsniff.py">TCP to WebSocket</a>. \n                This is read only, MAVLink commands are not sent (including stream rate requests).'
const HEARTBEAT_HELP =
  'If enabled the dashboard will send a MAVLink heartbeat at 1Hz. The source system and component IDs can be selected and a optional signing passphrase provided.'

/** The connection popup and a way to close its connection when the menu is removed. */
export interface ConnectionPanel {
  readonly element: HTMLDivElement
  /** Closes the connection this panel opened (proven bug #68: upstream left it open). */
  dispose(): void
}

/** Connection settings popup and its controller (upstream `setup_connect`). */
export function createConnectionPanel(host: MenuHost, ui: ConnectionUi): ConnectionPanel {
  const { element, body, close } = panel('Connection settings')
  close.onclick = () => ui.hide()

  const url = el('input')
  url.type = 'url'
  url.placeholder = 'ws://127.0.0.1:5863'
  url.required = true
  url.pattern = '^(ws|wss)://.*'
  const heartbeat = checkbox('Enable heartbeat')
  heartbeat.row.append(' ', helpIcon(HEARTBEAT_HELP))
  const heartbeatOptions = el('div', 'td-panel__group')
  heartbeatOptions.style.display = 'none'
  const sysid = numberInput('254', '1', '255')
  const compid = numberInput('190', '0', '255')
  const signing = el('input')
  signing.type = 'password'
  signing.placeholder = 'Signing disabled'
  heartbeatOptions.append(
    field('Source system ID', sysid),
    field('Source component ID', compid),
    field('Signing passphrase', signing)
  )
  const connect = button('Connect', 'apwt-btn apwt-btn--primary')
  const disconnect = button('Disconnect')
  const actions = el('div', 'td-panel__row')
  actions.append(connect, disconnect)
  body.append(field('Server address', url, helpIcon(ADDRESS_HELP)), heartbeat.row, heartbeatOptions, actions)

  heartbeat.input.onchange = () => {
    heartbeatOptions.style.display = heartbeat.input.checked ? 'block' : 'none'
  }

  const settings = (): ConnectionSettings => ({
    url: url.value,
    heartbeat: heartbeat.input.checked,
    systemId: sysid.value,
    componentId: compid.value,
    passphrase: signing.value
  })

  const controller = new ConnectionController({
    processor: host.mavlink,
    createSocket: browserSocketFactory,
    timers: browserTimers,
    now: () => Date.now(),
    settings,
    events: {
      view: (view) => {
        ui.setColor(view.color)
        for (const input of [connect, url, heartbeat.input, signing, sysid, compid]) input.disabled = view.inputsLocked
        disconnect.disabled = !view.disconnectEnabled
      },
      opened: (address) => {
        ui.hide()
        url.value = address
      },
      message: (message) => host.publish(message),
      failed: (error) => void showMessage(error instanceof Error ? error.message : String(error))
    }
  })
  // Initial state (upstream `set_inputs(false)` before anything else).
  connect.disabled = false
  disconnect.disabled = true

  connect.onclick = () => {
    controller.connectClicked(() => {
      if (url.checkValidity()) return true
      // Invalid address: re-show the popup and focus the address.
      ui.show()
      url.focus()
      return false
    })
  }
  disconnect.onclick = () => controller.disconnectClicked()

  // Settings from the page link.
  const hash = host.hashSettings
  if (hash.ws !== null && hash.ws !== '') url.value = hash.ws
  if (hash.heartbeat) {
    heartbeat.input.checked = true
    heartbeatOptions.style.display = 'block'
  }
  if (hash.sysid !== null && hash.sysid !== '') sysid.value = hash.sysid
  if (hash.compid !== null && hash.compid !== '') compid.value = hash.compid
  if (hash.signing !== null && hash.signing !== '') signing.value = hash.signing

  host.setConnectionParams(() => ({
    ws: url.value,
    heartbeat: heartbeat.input.checked,
    sysid: sysid.value,
    compid: compid.value,
    signing: signing.value
  }))

  controller.autoConnect(hash.ws, hash.signing)
  return { element, dispose: () => controller.dispose() }
}
