// Oracle tests for the parameter editor's decisions and texts: upstream
// `modules/MAVLink/mavparam-ui.js` runs in `node:vm` over a minimal fake DOM, driven against
// upstream `MAVParam`, and its rendered rows, counts, files and messages are compared with
// `params/editor.ts` on the same parameters and definitions.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { paramsFixture, UPSTREAM, upstreamSource } from '../test-utils/upstream.js'
import { ParamDefinitions, type ParamDefinition } from './definitions.js'
import {
  BITMASK_ERROR,
  bitChecked,
  clientStatus,
  defaultText,
  importHeading,
  importPlan,
  metaStatusText,
  pageView,
  rowBits,
  rowDescription,
  rowHints,
  rowLabel,
  rowOptions,
  savedMessage,
  saveFileName,
  saveSelection,
  selectedOption,
  skippedText,
  toggleBit
} from './editor.js'
import { MavParam, type ParamFtpPort } from './model.js'
import { decodeParams, formatParamValue, parseParamText, saveParamText, type Param, type ParamType } from './packed.js'

// ---- Minimal DOM: just what MAVParamUI touches. ----

const anchorsClicked: { href: string; download: string }[] = []
const blobs = new Map<string, string>()

class FakeEl {
  children: FakeEl[] = []
  text = ''
  className = ''
  dataset: Record<string, string> = {}
  hidden = false
  disabled = false
  value = ''
  checked = false
  open = false
  href = ''
  download = ''
  files: unknown[] = []
  onclick?: () => void
  onchange?: () => void
  oninput?: () => void
  constructor(readonly tagName: string) {}
  get textContent(): string {
    return this.tagName === '#text' ? this.text : this.children.map((c) => c.textContent).join('')
  }
  set textContent(t: string) {
    this.children = []
    if (this.tagName === '#text') this.text = t
    else if (t !== '') this.children.push(textNode(t))
  }
  get classList() {
    const parts = () => this.className.split(' ').filter(Boolean)
    return {
      toggle: (c: string, on: boolean) => {
        this.className = [...parts().filter((p) => p !== c), ...(on ? [c] : [])].join(' ')
      },
      add: (c: string) => {
        this.className = [...parts(), c].join(' ')
      },
      contains: (c: string) => parts().includes(c)
    }
  }
  setAttribute(): void {}
  append(...nodes: (FakeEl | string)[]): void {
    for (const n of nodes) {
      const node = typeof n === 'string' ? textNode(n) : n
      if (node.tagName === '#fragment') this.children.push(...node.children.splice(0))
      else this.children.push(node)
    }
  }
  replaceChildren(...nodes: FakeEl[]): void {
    this.children = []
    this.append(...nodes)
  }
  click(): void {
    if (this.disabled) return
    if (this.tagName === 'a') anchorsClicked.push({ href: this.href, download: this.download })
    this.onclick?.()
  }
  showModal(): void {
    this.open = true
  }
  close(): void {
    this.open = false
  }
  remove(): void {}
}

function textNode(t: string): FakeEl {
  const n = new FakeEl('#text')
  n.text = t
  return n
}

const kids = (el: FakeEl | undefined, tag?: string): FakeEl[] =>
  (el?.children ?? []).filter((c) => (tag === undefined ? c.tagName !== '#text' : c.tagName === tag))

class FakeBlob {
  constructor(readonly parts: string[]) {}
}

// ---- Upstream modules. ----

interface UpstreamParam {
  name: string
  value: number
  type: number
  defaultValue?: number
}
interface UpstreamClient {
  params: Map<string, UpstreamParam>
  definitions: Map<string, unknown>
  busy: boolean
  refresh(): Promise<unknown>
}
interface UpstreamDefinitionsResult {
  definitions: Map<string, unknown>
  cached: boolean
  stale: boolean
}
interface UpstreamUI {
  summary: FakeEl
  metaStatus: FakeEl
  search: FakeEl
  changedOnly: FakeEl
  saveScope: FakeEl
  list: FakeEl
  count: FakeEl
  previous: FakeEl
  next: FakeEl
  importPanel: FakeEl
  fileInput: FakeEl
  page: number
  drafts: Map<string, string>
  setClient(client: UpstreamClient | null, vehicle?: string): void
  loadDefinitions(refresh?: boolean): Promise<void>
  render(): void
  save(): void
  loadFile(): Promise<void>
}

const require = createRequire(import.meta.url)
const upstreamParamModule = require(resolve(UPSTREAM, 'modules/MAVLink/mavparam.js')) as {
  MAVParam: (new (options: { ftp: unknown }) => UpstreamClient) & {
    encodeUpload(params: readonly { name: string; value: number; type: number }[]): Uint8Array
  }
  MAVParamDefinitions: { parse(data: unknown): Map<string, unknown> }
}
const { MAVParam: UpstreamMavParam, MAVParamDefinitions: UpstreamDefinitions } = upstreamParamModule

function upstreamUI(load: (vehicle: string) => Promise<UpstreamDefinitionsResult>): UpstreamUI {
  const body = new FakeEl('body')
  const context = createContext({
    document: {
      body,
      createElement: (tag: string) => new FakeEl(tag),
      createDocumentFragment: () => new FakeEl('#fragment'),
      createTextNode: (t: string) => textNode(t)
    },
    MAVParam: UpstreamMavParam,
    Blob: FakeBlob,
    URL: {
      createObjectURL: (b: FakeBlob) => {
        const url = `blob:${blobs.size}`
        blobs.set(url, b.parts.join(''))
        return url
      },
      revokeObjectURL: () => {}
    },
    setTimeout: () => 0
  })
  runInContext(upstreamSource('modules/MAVLink/mavparam-ui.js'), context)
  const ui: unknown = runInContext(
    'new MAVParamUI({definitions: {load: loadDefinitions}})',
    Object.assign(context, { loadDefinitions: load })
  )
  return ui as UpstreamUI
}

// ---- Shared inputs. ----

const fixture = paramsFixture()
const fixtureBytes = (): Uint8Array => Uint8Array.from(Buffer.from(fixture.hex, 'hex'))

/** A packed file with defaults off (magic 0x671b) holding `count` parameters, via upstream's encoder. */
function manyParams(count: number): Uint8Array {
  const list = Array.from({ length: count }, (_, i) => ({ name: `P${String(i).padStart(3, '0')}`, value: i, type: 3 }))
  const bytes = Uint8Array.from(UpstreamMavParam.encodeUpload(list))
  const view = new DataView(bytes.buffer)
  view.setUint16(4, view.getUint16(2, true), true)
  return bytes
}

/** Definitions with ordinary and malformed JSON values, to exercise every display branch. */
const definitionsJson = {
  Rover: {
    TEST_I8: {
      DisplayName: 'Motor speed',
      Description: 'Adjust the motor test speed',
      Units: 'm/s',
      Range: { low: '-128', high: '127' },
      Increment: 0.5,
      Values: { 0: 'Off', 1: 'On', '-12': 'Current' },
      RebootRequired: 'True'
    },
    TEST_I16: { DisplayName: [], Description: [null, 0, 'x'], Units: 5, Range: [1, 2], Values: 'abc', Increment: [[]] },
    TEST_I32: { humanName: 7, documentation: { a: 1 }, Range: '0 100', Bitmask: 'xy' },
    TEST_FLOAT: { displayName: 'Float', description: '', Range: { low: 0, high: null }, Values: [0, 'one'] },
    TEST_OPTIONS: {
      Description: 'Option flags',
      Bitmask: { 0: 'First option', 2: 'Third option', 31: 'Top', 32: 'Too high', x: 'Bad' }
    },
    TEST_READONLY: { Description: 'A read-only parameter', ReadOnly: 'True', Values: { 0: 'Zero' } }
  }
}

function upstreamClient(bytes: () => Uint8Array = fixtureBytes): UpstreamClient {
  return new UpstreamMavParam({ ftp: { getFile: (_path: string, cb: (data: Uint8Array) => void) => cb(bytes()) } })
}

function portClient(bytes: () => Uint8Array = fixtureBytes, definitions?: Map<string, ParamDefinition>): MavParam {
  const ftp: ParamFtpPort = {
    getFile: (_path, cb) => cb({ kind: 'done', value: bytes() }),
    putFile: (_path, data, cb) => cb({ kind: 'done', value: data.length })
  }
  const model = new MavParam(ftp)
  model.params = decodeParams(bytes())
  if (definitions !== undefined) model.setDefinitions(definitions)
  return model
}

const portFormat = (p: Param, value: number): string => formatParamValue(p, value)

async function loadedUI(bytes: () => Uint8Array = fixtureBytes): Promise<{ ui: UpstreamUI; client: UpstreamClient }> {
  const ui = upstreamUI(() =>
    Promise.resolve({ definitions: UpstreamDefinitions.parse(definitionsJson), cached: false, stale: false })
  )
  const client = upstreamClient(bytes)
  ui.setClient(client, 'Rover')
  await client.refresh()
  await ui.loadDefinitions()
  ui.render()
  return { ui, client }
}

interface RowView {
  label: string | null
  description: string
  hints: string
  defaultText: string
  options: [string, string][]
  selected: string | null
  bits: [string, string][]
  checked: boolean[]
}

function upstreamRow(row: FakeEl): RowView {
  const [heading, editor, defaults, help] = kids(row)
  const labelDiv = kids(heading, 'div')[0]
  const select = kids(editor, 'select')[0]
  const details = kids(editor, 'details')[0]
  const bitLabels = kids(details, 'label')
  return {
    label: labelDiv === undefined ? null : labelDiv.textContent,
    description: kids(help, 'p')[0]!.textContent,
    hints: kids(help, 'small')[0]!.textContent,
    defaultText: kids(defaults, 'span')[0]!.textContent,
    options: kids(select, 'option')
      .slice(1)
      .map((o) => [o.value, o.textContent]),
    selected: select === undefined ? null : select.value,
    bits: bitLabels.map((l) => {
      const text = l.textContent.trim()
      return [text.slice(0, text.indexOf(':')), text]
    }),
    checked: bitLabels.map((l) => kids(l, 'input')[0]!.checked)
  }
}

function portRow(p: Param, d: ParamDefinition | undefined, valueText = formatParamValue(p)): RowView {
  const options = rowOptions(d)
  const bits = rowBits(d)
  return {
    label: rowLabel(d),
    description: rowDescription(d),
    hints: rowHints(d),
    defaultText: defaultText(p, portFormat),
    options,
    selected: options.length ? selectedOption(d, p) : null,
    bits,
    checked: bits.map(([bit]) => bitChecked(valueText, bit))
  }
}

const rowsOf = (ui: UpstreamUI): FakeEl[] => kids(ui.list, 'article')
const rowInput = (row: FakeEl): FakeEl => kids(kids(kids(row)[1], 'label')[0], 'input')[0]!

describe('parameter editor (oracle against upstream mavparam-ui.js)', () => {
  it('status and description messages', async () => {
    const results: UpstreamDefinitionsResult[] = []
    let fail = false
    const ui = upstreamUI(() => {
      if (fail) return Promise.reject(new Error('offline'))
      return Promise.resolve(results.shift()!)
    })
    expect(ui.summary.textContent).toBe(clientStatus(false, false))
    expect(ui.metaStatus.textContent).toBe('Descriptions not loaded.')
    const client = upstreamClient()
    ui.setClient(client, 'Plane')
    expect(ui.summary.textContent).toBe(clientStatus(true, false))
    for (const [cached, stale] of [
      [false, false],
      [true, false],
      [true, true]
    ] as const) {
      results.push({ definitions: new Map(), cached, stale })
      await ui.loadDefinitions()
      expect(ui.metaStatus.textContent).toBe(metaStatusText('Plane', { cached, stale }))
    }
    fail = true
    await ui.loadDefinitions()
    expect(ui.metaStatus.textContent).toBe('Descriptions unavailable. Parameter values can still be edited.')
    ui.setClient(null)
    expect(ui.summary.textContent).toBe(clientStatus(false, true))
    // The descriptions status survives a client change (the port keeps it as well).
    expect(ui.metaStatus.textContent).toBe('Descriptions unavailable. Parameter values can still be edited.')
  })

  it('rows: labels, descriptions, hints, defaults, enum options and bitmask choices for ordinary and malformed definitions', async () => {
    const { ui } = await loadedUI()
    const params = decodeParams(fixtureBytes())
    const definitions = ParamDefinitions.parse(definitionsJson)
    const rows = rowsOf(ui)
    expect(rows.length).toBe(params.size)
    for (const row of rows) {
      const name = row.dataset.parameter!
      expect(portRow(params.get(name)!, definitions.get(name)), name).toEqual(upstreamRow(row))
    }
    // Rows without definitions.
    const bare = upstreamUI(() => Promise.reject(new Error('offline')))
    const client = upstreamClient()
    bare.setClient(client, 'Rover')
    await client.refresh()
    bare.render()
    for (const row of rowsOf(bare)) {
      const name = row.dataset.parameter!
      expect(portRow(params.get(name)!, undefined), name).toEqual(upstreamRow(row))
    }
  })

  it('search agrees with upstream, including malformed label and description values', async () => {
    const { ui } = await loadedUI()
    const model = portClient(fixtureBytes, ParamDefinitions.parse(definitionsJson))
    for (const query of ['', 'motor', 'x', 'object', '7', 'null', '0', 'option flags', 'test_i', 'zzz']) {
      for (const nonDefault of [false, true]) {
        ui.search.value = query
        ui.changedOnly.checked = nonDefault
        ui.render()
        const theirs = rowsOf(ui).map((r) => r.dataset.parameter)
        expect(
          model.search(query, nonDefault).map((p) => p.name),
          `${query} ${nonDefault}`
        ).toEqual(theirs)
      }
    }
  })

  it('bitmask checkboxes and toggling for typed values', async () => {
    const { ui } = await loadedUI()
    const definitions = ParamDefinitions.parse(definitionsJson)
    const params = decodeParams(fixtureBytes())
    const name = 'TEST_OPTIONS'
    const p = params.get(name)!
    const texts = ['5', '-1', '3.5', '', 'abc', '2147483648', '-2147483648', '1e3', ' 7', '0x10', '4294967295']
    for (const text of texts) {
      ui.search.value = name
      ui.drafts.set(name, text)
      ui.render()
      const row = rowsOf(ui)[0]!
      expect(portRow(p, definitions.get(name), text), `checked ${text}`).toEqual(upstreamRow(row))
      for (const [bitIndex, [bit]] of rowBits(definitions.get(name)).entries()) {
        for (const checked of [true, false]) {
          ui.drafts.set(name, text)
          ui.render()
          const fresh = rowsOf(ui)[0]!
          const input = rowInput(fresh)
          const checkbox = kids(kids(kids(kids(fresh)[1], 'details')[0], 'label')[bitIndex], 'input')[0]!
          ui.summary.textContent = ''
          checkbox.checked = checked
          checkbox.onchange?.()
          let ours: string
          try {
            ours = toggleBit(text, bit, checked, p.type)
          } catch {
            ours = `error ${BITMASK_ERROR}`
          }
          const theirs = ui.summary.textContent === BITMASK_ERROR ? `error ${ui.summary.textContent}` : input.value
          expect(ours, `${text} bit ${bit} ${checked}`).toBe(theirs)
        }
      }
    }
    // Other packed types keep values beyond int32 (upstream only wraps type 3).
    for (const type of [1, 2, 4] as const satisfies readonly ParamType[])
      expect(toggleBit('2147483648', '0', true, type)).toBe('2147483649')
  })

  it('page counts, navigation limits and clamping', async () => {
    const bytes = (): Uint8Array => manyParams(123)
    const { ui } = await loadedUI(bytes)
    const total = 123
    const model = portClient(bytes)
    for (const [query, page] of [
      ['', 0],
      ['', 1],
      ['', 2],
      ['', 7],
      ['P1', 1],
      ['P05', 3],
      ['none', 2]
    ] as const) {
      ui.search.value = query
      ui.page = page
      ui.render()
      const found = model.search(query)
      const view = pageView(page, found.length, total)
      expect(ui.count.textContent).toBe(view.countText)
      expect(ui.page).toBe(view.page)
      expect(ui.previous.disabled).toBe(view.page === 0)
      expect(ui.next.disabled).toBe(view.page + 1 >= view.pages)
      expect(rowsOf(ui).map((r) => r.dataset.parameter)).toEqual(found.slice(view.start, view.start + 50).map((p) => p.name))
    }
  })

  it('save to file: selection, file name, contents and message', async () => {
    const { ui } = await loadedUI()
    const params = decodeParams(fixtureBytes())
    for (const scope of ['all', 'changed'] as const) {
      ui.saveScope.value = scope
      ui.search.value = 'TEST_I32'
      ui.save()
      const anchor = anchorsClicked.at(-1)!
      const list = saveSelection(params.values(), scope)
      expect(anchor.download).toBe(saveFileName('Rover', scope))
      expect(blobs.get(anchor.href)).toBe(saveParamText(list))
      expect(ui.summary.textContent).toBe(savedMessage(list.length))
    }
  })

  it('load from file: preview, read-only skip and errors', async () => {
    const definitions = ParamDefinitions.parse(definitionsJson)
    const cases: { name: string; text: string; size?: number }[] = [
      { name: 'test.parm', text: 'TEST_I32 16777219\nTEST_READONLY 0\n' },
      { name: 'ro.parm', text: 'TEST_READONLY 5\nTEST_I8 -12\n' },
      { name: 'float.parm', text: 'TEST_FLOAT 0.1\nTEST_I16 7' },
      { name: 'unknown.parm', text: 'NOPE 1' },
      { name: 'bad.parm', text: 'TEST_I8 1.5' },
      { name: 'junk.parm', text: 'TEST_I8' },
      { name: 'big.parm', text: 'TEST_I8 1', size: 4 * 1024 * 1024 + 1 }
    ]
    for (const c of cases) {
      const { ui } = await loadedUI()
      ui.summary.textContent = ''
      ui.fileInput.files = [{ name: c.name, size: c.size ?? c.text.length, text: () => Promise.resolve(c.text) }]
      await ui.loadFile()
      let ours: string[]
      try {
        if ((c.size ?? 0) > 4 * 1024 * 1024) throw new Error('Parameter file exceeds 4 MiB')
        const plan = importPlan(portClient(fixtureBytes, definitions), parseParamText(c.text))
        ours = [
          importHeading(c.name, plan.changes.length),
          ...(plan.skipped.length ? [skippedText(plan.skipped)] : []),
          plan.changes.map((p) => `${p.name}: ${formatParamValue(p, p.previousValue)} → ${formatParamValue(p)}`).join('')
        ]
      } catch (e) {
        ours = [`error ${(e as Error).message}`]
      }
      const theirs = ui.importPanel.hidden
        ? [`error ${ui.summary.textContent}`]
        : kids(ui.importPanel)
            .filter((el) => el.tagName !== 'button')
            .map((el) => el.textContent)
      expect(ours, c.name).toEqual(theirs)
    }
  })
})
