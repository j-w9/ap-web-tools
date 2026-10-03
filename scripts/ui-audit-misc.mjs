// UI audit states for AI Log Analyzer, DFU Loader and SysID (imported by ui-audit.config.mjs).
// Every external service is stubbed in the page: the OpenAI REST API (recorded-shape answers; no key
// is real and nothing reaches OpenAI), WebUSB (the app tests' scripted DFU device) and Pyodide (a
// stand-in module, so no 20 MB download; its output is canned text, not a real fit).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const sitl = 'packages/dataflash/test-fixtures/copter-sitl.bin'

const openLog = async (page, file) => {
  await page.locator('input[type=file]').first().setInputFiles(resolve(root, file))
  await page.waitForTimeout(2000)
}

const toTop = async (page) => {
  // Park the pointer so no hover state shows in the capture.
  await page.mouse.move(0, 0)
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    for (const el of document.querySelectorAll('.apwt-table-wrap')) el.scrollLeft = 0
  })
}

// ------------------------------------------------------------------------------ AI Log Analyzer

const chartPng = readFileSync(resolve(root, 'apps/ai-log-analyzer/test-fixtures/ui-chart.png'))
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

const textDelta = (id, value) => ({
  event: 'thread.message.delta',
  data: { id, object: 'thread.message.delta', delta: { content: [{ index: 0, type: 'text', text: { value } }] } }
})
const imageDelta = (fileId) => ({
  event: 'thread.message.delta',
  data: {
    id: 'msg_img',
    object: 'thread.message.delta',
    delta: { content: [{ index: 0, type: 'image_file', image_file: { file_id: fileId } }] }
  }
})
const requiresAction = (runId, name, args) => ({
  event: 'thread.run.requires_action',
  data: {
    id: runId,
    object: 'thread.run',
    status: 'requires_action',
    required_action: {
      type: 'submit_tool_outputs',
      submit_tool_outputs: { tool_calls: [{ id: `call_${runId}`, type: 'function', function: { name, arguments: args } }] }
    }
  }
})
const completed = { event: 'thread.run.completed', data: { id: 'run', object: 'thread.run', status: 'completed' } }

const REPLY = [
  '## Attitude tracking\n\nRoll and pitch followed their targets closely for the whole flight. ',
  'Yaw lagged during the fast turns near the end.\n\n',
  '| Axis | Max error (deg) | RMS error (deg) | Samples | Verdict |\n| --- | --- | --- | --- | --- |\n',
  '| Roll | 2.4 | 0.6 | 11960 | Good |\n| Pitch | 1.9 | 0.5 | 11960 | Good |\n| Yaw | 6.1 | 1.8 | 11960 | Check yaw tune |\n\n',
  'I computed the errors from `output.json` like this:\n\n',
  "```python\nimport json, pandas as pd\natt = pd.DataFrame(json.load(open('/mnt/data/output.json')))\n",
  "err = (att['DesRoll'] - att['Roll']).abs()\nprint(f'max {err.max():.1f} deg, rms {(err ** 2).mean() ** 0.5:.1f} deg  # roll error over the whole log')\n```\n\n",
  'The chart in **Visualizations** shows roll and pitch over time.'
]

/** A stateful stand-in for the OpenAI Assistants API at api.openai.com. */
function openAiMock({ unauthorized = false } = {}) {
  const runs = [
    // First question: the assistant asks for ATT, which the page answers from the log.
    [requiresAction('run_1', 'get', '{"message_type":"ATT"}')],
    // After the fixed "data extracted" message: Markdown with a table and a code block, then a chart.
    [...REPLY.map((t) => textDelta('msg_reply', t)), imageDelta('file-chart'), completed],
    // Second question: a message the log does not have, so the tool call fails...
    [requiresAction('run_3', 'get', '{"message_type":"EFI"}')],
    // ...and the run fails after the outputs are submitted.
    [
      {
        event: 'thread.run.failed',
        data: {
          id: 'run_4',
          object: 'thread.run',
          status: 'failed',
          last_error: { code: 'rate_limit_exceeded', message: 'Rate limit reached for gpt-4o. Please try again in 20s.' }
        }
      }
    ]
  ]
  let file = 0
  return async (route) => {
    const request = route.request()
    const method = request.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(request.url()).pathname.replace(/^\/v1/, '')
    const json = (body, status = 200) => route.fulfill({ status, headers: CORS, json: body })
    if (unauthorized) {
      return json(
        {
          error: {
            message: 'Incorrect API key provided: sk-ui-a***udit.',
            type: 'invalid_request_error',
            code: 'invalid_api_key'
          }
        },
        401
      )
    }
    if (method === 'GET' && path === '/assistants') {
      return json({ object: 'list', data: [{ id: 'asst_ui', object: 'assistant', name: 'Log Analyzer' }], has_more: false })
    }
    if (method === 'POST' && path === '/threads') return json({ id: 'thread_ui', object: 'thread' })
    if (method === 'POST' && /\/messages$/.test(path)) return json({ id: `msg_${Date.now()}`, object: 'thread.message' })
    if (method === 'POST' && /\/cancel$/.test(path)) return json({ id: 'run_1', object: 'thread.run', status: 'cancelling' })
    if (method === 'POST' && (/\/runs$/.test(path) || /\/submit_tool_outputs$/.test(path))) {
      const events = runs.shift() ?? [completed]
      const body =
        events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('') + 'event: done\ndata: [DONE]\n\n'
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body })
    }
    if (method === 'GET' && path === '/files') return json({ object: 'list', data: [], has_more: false })
    if (method === 'POST' && path === '/files') {
      return json({ id: `file-out${++file}`, object: 'file', filename: 'output.json', purpose: 'assistants' })
    }
    if (method === 'DELETE') return json({ id: path.split('/').pop(), deleted: true })
    if (method === 'GET' && /\/content$/.test(path)) {
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/binary' }, body: chartPng })
    }
    return json({ error: { message: `No route ${method} ${path}`, type: 'invalid_request_error' } }, 404)
  }
}

const connectKey = async (page, options) => {
  await page.route('https://api.openai.com/**', openAiMock(options))
  await page.getByLabel('OpenAI API key').fill('sk-ui-audit-not-a-real-key')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
}

const ask = async (page, text, waitFor) => {
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill(text)
  await box.press('Enter')
  await waitFor.waitFor({ timeout: 15000 })
}

const aiLogAnalyzer = [
  { name: 'log', files: [sitl] },
  {
    // A rejected key: the form stays, with the error under it.
    name: 'bad-key',
    steps: async (page) => {
      await openLog(page, sitl)
      await connectKey(page, { unauthorized: true })
      await page.getByText('Invalid OpenAI API key').first().waitFor()
      await toTop(page)
    }
  },
  {
    // The Markdown reply scrolled into view in the transcript: table and code block in the bubble.
    name: 'reply',
    steps: async (page) => {
      await openLog(page, sitl)
      await connectKey(page)
      await page.getByText('Connected', { exact: true }).waitFor()
      await ask(page, 'How well did roll and pitch track their targets?', page.locator('.ala-figure img'))
      await page.evaluate(() => {
        const bubble = document.querySelector('.ala-msg--assistant')
        const transcript = document.querySelector('.ala-transcript')
        if (bubble && transcript) {
          transcript.scrollTop += bubble.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 8
        }
      })
      await toTop(page)
    }
  },
  {
    // Tool call answered from the log, a Markdown reply with a table and code, a chart, a failed tool
    // call and a failed run.
    name: 'conversation',
    steps: async (page) => {
      await openLog(page, sitl)
      await connectKey(page)
      await page.getByText('Connected', { exact: true }).waitFor()
      await ask(page, 'How well did roll and pitch track their targets?', page.locator('.ala-figure img'))
      await ask(page, 'Did the EFI report any engine problems?', page.locator('.ala-notice--error').last())
      await page.waitForTimeout(300)
      await toTop(page)
    }
  }
]

// ----------------------------------------------------------------------------------- DFU Loader

// The app tests' scripted WebUSB device, compiled for the page.
const fakeUsbScript = transformSync(readFileSync(resolve(root, 'apps/dfu-loader/src/test-utils/fake-usb.ts'), 'utf8'), {
  loader: 'ts',
  format: 'iife',
  globalName: '__apwtFakeUsb'
}).code

/** An STM32F4 bootloader with its four DFU interfaces; `pollTimeout` slows the download down. */
const dfuDevice = (extra = {}) => ({
  alternates: [
    { alternateSetting: 0, interfaceName: '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg' },
    { alternateSetting: 1, interfaceName: '@Option Bytes  /0x1FFFC000/01*016 e' },
    { alternateSetting: 2, interfaceName: '@OTP Memory /0x1FFF7800/01*512 e,01*016 e' },
    { alternateSetting: 3, interfaceName: '@Device Feature/0xFFFF0000/01*004 e' }
  ],
  pollTimeout: 25,
  ...extra
})

const installUsb = (page, options) =>
  page.addInitScript({
    content: `${fakeUsbScript}
      ;(() => {
        const usb = new __apwtFakeUsb.FakeUsb([new __apwtFakeUsb.FakeUsbDevice(${JSON.stringify(options)})])
        Object.defineProperty(navigator, 'usb', { value: usb, configurable: true })
      })()`
  })

const bootloader = {
  name: 'arkv6x_bl.bin',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(Uint8Array.from({ length: 40 * 1024 }, (_, i) => (i * 7 + 1) & 0xff))
}

/** Reload with the fake device, connect, and optionally choose the file and flash. */
const dfu =
  ({ device = {}, file = false, flash = null } = {}) =>
  async (page) => {
    await installUsb(page, dfuDevice(device))
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByText('DFU interfaces found').waitFor()
    if (file || flash) await page.locator('input[type=file]').first().setInputFiles(bootloader)
    if (flash) {
      await page.getByRole('button', { name: /flash bootloader/i }).click()
      if (flash === 'running') {
        await page.locator('.dfu-log__progress').first().waitFor()
        await page.waitForTimeout(1500)
      } else {
        const line = flash === 'error' ? page.locator('.dfu-log__line--error') : page.getByText(flash, { exact: true })
        await line.first().waitFor({ timeout: 30000 })
      }
    }
    await toTop(page)
  }

const dfuLoader = [
  {
    name: 'no-webusb',
    steps: async (page) => {
      await page.addInitScript(() => {
        delete Navigator.prototype.usb
      })
      await page.reload({ waitUntil: 'networkidle' })
    }
  },
  { name: 'connected', steps: dfu() },
  { name: 'file', steps: dfu({ file: true }) },
  { name: 'flashing', steps: dfu({ flash: 'running', device: { pollTimeout: 120 } }) },
  { name: 'done', steps: dfu({ flash: 'Done!' }) },
  // The device reports an error status on the 30th GETSTATUS, part way through the download.
  { name: 'flash-error', steps: dfu({ flash: 'error', device: { failGetStatus: { at: 30, status: 3 } } }) }
]

// ---------------------------------------------------------------------------------------- SysID

/**
 * A stand-in for the `pyodide` module: loads instantly once `window.__apwtReleasePython()` is called,
 * and answers the transfer function script with a first-order response and canned printout.
 */
const FAKE_PYODIDE = `
const out = (text) => {
  const el = document.getElementById('output')
  if (el) { el.value += text + '\\n'; el.scrollTop = el.scrollHeight }
}
let release
const released = new Promise((r) => { release = r })
window.__apwtReleasePython = () => release()
class PyCallable {}
export async function loadPyodide() {
  await released
  const values = new Map()
  const install = Object.setPrototypeOf(async () => {}, PyCallable.prototype)
  return {
    ffi: { PyCallable },
    FS: { writeFile() {} },
    globals: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    loadPackage: async () => {},
    pyimport: () => install,
    runPython(code) {
      if (!code.includes('freq_js')) return
      const n = 200
      const freq = Array.from({ length: n }, (_, i) => 10 ** (Math.log10(0.5) + (i / (n - 1)) * Math.log10(60)))
      const tf = freq.map((w) => ({ mag: -10 * Math.log10(1 + (w / 6) ** 2), phase: (-Math.atan(w / 6) * 180) / Math.PI }))
      values.set('freq_js', freq)
      values.set('mag_js', tf.map((p) => p.mag))
      values.set('phase_js', tf.map((p) => p.phase))
      values.set('h_amp_js', tf.map((p, i) => p.mag + Math.sin(i / 3) * 0.8))
      values.set('h_phase_js', tf.map((p, i) => p.phase + Math.cos(i / 4) * 3))
      values.set('coherence_js', freq.map((w) => Math.max(0.2, 1 - (w / 80) ** 2)))
      out('numerator:  [5.98]')
      out('denominator:  [1.   5.97]')
      out('tau:  0.1675')
      out('fitting   cost: 0.0213')
    }
  }
}
`

const stubPython = async (page, { ready = true } = {}) => {
  await page.route('**/node_modules/.vite/deps/pyodide.js*', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: FAKE_PYODIDE })
  )
  await page.reload({ waitUntil: 'networkidle' })
  if (ready) {
    await page.evaluate(() => window.__apwtReleasePython())
    await page.getByText('Python ready').waitFor()
  }
}

const sidLog = 'apps/sysid/test-fixtures/ui-sid.bin'

/** Picks message and field in the nth signal picker on the page. */
const pickSignal = async (page, n, message, field) => {
  const picker = page.locator('.sysid-picker').nth(n)
  await picker.getByRole('combobox', { name: 'Message' }).selectOption(message)
  await picker.getByRole('combobox', { name: 'Field' }).selectOption(field)
}

const model = (page, name) => page.getByRole('radio', { name, exact: true }).check({ force: true })

const sysid = [
  {
    name: 'python-loading',
    steps: async (page) => {
      await stubPython(page, { ready: false })
      await openLog(page, sidLog)
    }
  },
  {
    name: 'log',
    steps: async (page) => {
      await stubPython(page)
      await openLog(page, sidLog)
    }
  },
  {
    name: 'transfer-function',
    steps: async (page) => {
      await stubPython(page)
      await openLog(page, sidLog)
      await model(page, 'Transfer function')
      await pickSignal(page, 0, 'RATE', 'ROut')
      await pickSignal(page, 1, 'SIDD', 'Gx')
      await page.getByLabel('Numerator').fill('b0')
      await page.getByLabel('Denominator').fill('s + a0')
      await page.getByLabel('Symbolic params').fill('b0 a0')
      await page.getByRole('button', { name: 'Submit' }).click()
      await page.locator('.sysid-result-plot').waitFor()
      await page.waitForTimeout(800)
      await toTop(page)
    }
  },
  {
    name: 'state-space-manual',
    steps: async (page) => {
      await stubPython(page)
      await openLog(page, sidLog)
      await model(page, 'State space')
      await page.getByLabel('Outputs').fill('2')
      await page.getByLabel('Matrix A order').fill('3')
      await page.getByLabel('Number of params').fill('5')
      await page.getByLabel('Number of constraints').fill('2')
      await page.getByRole('button', { name: 'Generate fields' }).click()
      await toTop(page)
    }
  },
  ...['Multirotor roll', 'Multirotor yaw'].map((preset) => ({
    name: `state-space-${preset.split(' ')[1]}`,
    steps: async (page) => {
      await stubPython(page)
      await openLog(page, sidLog)
      await model(page, 'State space')
      await model(page, preset)
      await page.getByRole('button', { name: 'Generate fields' }).click()
      await toTop(page)
    }
  })),
  {
    // Generate with no sizes: upstream's alert, shown in the page.
    name: 'state-space-alert',
    steps: async (page) => {
      await stubPython(page)
      await openLog(page, sidLog)
      await model(page, 'State space')
      await page.getByRole('button', { name: 'Generate fields' }).click()
      await toTop(page)
    }
  }
]

export const MISC_STATES = { 'ai-log-analyzer': aiLogAnalyzer, 'dfu-loader': dfuLoader, sysid }
