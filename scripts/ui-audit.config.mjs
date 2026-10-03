import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MISC_STATES } from './ui-audit-misc.mjs'

// States captured per tool by scripts/ui-audit.mjs. Every tool gets an "empty" state automatically.
// A state's `files` are set on the page's first <input type="file"> (paths relative to the repo root);
// `steps` run afterwards in the page (Playwright Page API) to reach the state, e.g. clicking a button.
// Extend this file as you audit a tool; keep fixtures under packages/*/test-fixtures or an app's own folder.
const sitl = 'packages/dataflash/test-fixtures/copter-sitl.bin'
const files = 'packages/dataflash/test-fixtures/copter-files.bin'

/** Picks a chip (visually hidden radio or checkbox inside a label) by its exact label. */
const chip = (page, name, role = 'radio') => page.getByRole(role, { name, exact: true }).check({ force: true })

/** Undo the scrolling that clicks cause, so full-page captures show the page from the top. */
const toTop = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 0)
    for (const el of document.querySelectorAll('.apwt-table-wrap')) el.scrollLeft = 0
  })

/** Kinematic Tool: choose vehicle, axis and mode, then let the simulation and plots settle. */
const kinematic = (vehicle, axis, mode) => async (page) => {
  await chip(page, vehicle)
  await chip(page, axis)
  await chip(page, mode)
  // The default desired rate is 0, which gives flat rate plots; ask for a turn instead.
  if (mode !== 'Angle') {
    await page.getByLabel('Desired rate').fill('90')
    await page.getByLabel('Desired rate').press('Enter')
  }
  await page.waitForTimeout(800)
  await toTop(page)
}

/** S-Curve Tool: wait for the WebAssembly simulation, then set the 3D path options. */
const scurve =
  (colour, radius = false) =>
  async (page) => {
    await page.locator('.scurve-plot3d').waitFor({ timeout: 30000 })
    await chip(page, colour)
    if (radius) await chip(page, 'Waypoint radius', 'checkbox')
    await page.waitForTimeout(1500)
    await toTop(page)
  }

// Geofence Generator: Overpass and Nominatim answers recorded for Virginia Water (Surrey, UK), so the
// captures do not depend on those services. Map tiles are live. Data (c) OpenStreetMap contributors, ODbL.
const gfFixtures = resolve(import.meta.dirname, '../apps/geofence-generator/test-fixtures')
const overpassXml = readFileSync(resolve(gfFixtures, 'overpass-virginia-water.xml'), 'utf8')
const nominatimJson = readFileSync(resolve(gfFixtures, 'nominatim-virginia-water.json'), 'utf8')

/** Mock the services, open the map over the lake, and optionally search the area. */
const geofence =
  ({ search = true } = {}) =>
  async (page) => {
    await page.route('https://overpass-api.de/**', (r) => r.fulfill({ body: overpassXml, contentType: 'application/osm3s+xml' }))
    await page.route('https://nominatim.openstreetmap.org/**', (r) =>
      r.fulfill({ body: nominatimJson, contentType: 'application/json' })
    )
    await page.evaluate(() => localStorage.setItem('apwt-geofence-view', JSON.stringify({ lat: 51.411, lng: -0.607, zoom: 13 })))
    await page.reload({ waitUntil: 'networkidle' })
    if (search) {
      await page.getByRole('button', { name: 'Search this area' }).click()
      await page.locator('.apwt-table').first().waitFor()
    }
    await toTop(page)
  }

const selectLake = async (page) => {
  await page
    .getByRole('row', { name: /Virginia Water/ })
    .getByRole('button', { name: 'Select' })
    .click()
  await page.getByRole('button', { name: 'Download fence' }).waitFor()
  await page.waitForTimeout(800)
  await toTop(page)
}

/** @type {Record<string, { name: string; files?: string[]; steps?: (page: import('playwright').Page) => Promise<void> }[]>} */
/**
 * Hardware Report checks firmware hashes against the GitHub API, which rate-limits unauthenticated
 * clients long before a full audit run is done. Answer from canned data instead: Copter-4.6.3 is a
 * release tag, any other hash is a commit at the head of master. Then open the log.
 */
const hardwareLog = (file) => async (page) => {
  await page.route('https://api.github.com/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const json = path.endsWith('/git/refs/tags')
      ? [{ ref: 'refs/tags/Copter-4.6.3', object: { sha: '92b0cd78f2c0b0f4d5a5d1c2e3f4a5b6c7d8e9f0' } }]
      : path.endsWith('/branches-where-head')
        ? [{ name: 'master' }]
        : { sha: path.split('/').pop(), html_url: `https://github.com/ArduPilot/ardupilot/commit/${path.split('/').pop()}` }
    return route.fulfill({ json })
  })
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(resolve(import.meta.dirname, '..', file))
  await page.waitForTimeout(2500)
}

const filterReviewLog = 'apps/filter-review/test-fixtures/ui-batch.bin'
const logFinderFiles = [
  sitl,
  files,
  ...['cube-00000012', 'cube-00000013', 'cube-00000014', 'matek-00000003', 'matek-00000004', 'pixhawk6x-00000001'].map(
    (n) => `apps/log-finder/test-fixtures/${n}.BIN`
  )
]

/**
 * Simple GCS, Telemetry Dashboard: replace `WebSocket` with a stub whose peer is a scripted vehicle
 * module served by the dev server (`createPeer(socket)`), so no real vehicle or relay is involved.
 */
const stubWebSocket = async (page, peerModule) => {
  await page.addInitScript((modulePath) => {
    const RealWebSocket = window.WebSocket
    class StubWebSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      constructor(url, protocols) {
        // The dev server's own hot-reload socket stays real.
        if (String(protocols).startsWith('vite-')) return new RealWebSocket(url, protocols)
        super()
        this.url = url
        this.readyState = 0
        this.binaryType = 'blob'
        this.protocol = ''
        this.extensions = ''
        this.bufferedAmount = 0
        this.onopen = this.onclose = this.onmessage = this.onerror = null
        this.peer = import(modulePath).then((m) => m.createPeer(this))
      }
      _fire(event) {
        this[`on${event.type}`]?.(event)
        this.dispatchEvent(event)
      }
      _open() {
        if (this.readyState !== 0) return
        this.readyState = 1
        this._fire(new Event('open'))
      }
      _deliver(bytes) {
        if (this.readyState !== 1) return
        const copy = Uint8Array.from(bytes)
        this._fire(new MessageEvent('message', { data: this.binaryType === 'arraybuffer' ? copy.buffer : new Blob([copy]) }))
      }
      send(data) {
        if (this.readyState !== 1) throw new DOMException('Still in CONNECTING state', 'InvalidStateError')
        void this.peer.then((p) => p.receive(data))
      }
      close(code = 1000, reason = '') {
        if (this.readyState >= 2) return
        this.readyState = 3
        void this.peer.then((p) => p.stop())
        setTimeout(() => this._fire(new CloseEvent('close', { code, reason, wasClean: true })), 0)
      }
    }
    window.WebSocket = StubWebSocket
  }, peerModule)
  await page.reload({ waitUntil: 'networkidle' })
}

/** Simple GCS: connect to the scripted rover and let telemetry, fence and mission arrive. */
const gcsConnected = async (page) => {
  await stubWebSocket(page, '/apps/simple-gcs/src/test-utils/ui-peer.ts')
  await page.locator('#connectBtn').click()
  await page.locator('form[aria-label="Connection settings"] button[type=submit]').click()
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Fetch mission' }).click()
  await page.waitForTimeout(2500)
  await toTop(page)
}

/** Telemetry Dashboard: the default layout fed by a scripted vehicle. */
const dashboardLive = async (page) => {
  await stubWebSocket(page, '/apps/telemetry-dashboard/src/test-support/ui-peer.ts')
  await page.waitForTimeout(4000)
  await toTop(page)
}

/** Telemetry Dashboard: turn on widget edit from the menu widget's settings. */
const dashboardEdit = async (page) => {
  await dashboardLive(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Enable widget edit').check()
  await page.locator('.td-panel').getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(300)
}

/** Telemetry Dashboard: double click the first value widget for its options popup. */
const dashboardWidgetOptions = async (page) => {
  await dashboardEdit(page)
  await page
    .locator('#dashboard .grid-stack-item')
    .filter({ has: page.locator('iframe') })
    .nth(3)
    .dblclick()
  await page.locator('.td-widget-tip .td-form .formio-form').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
}

/** Video Overlay: a short generated test video and the SITL log. */
const voVideo = 'apps/video-overlay/test-fixtures/ui-test.mp4'
const videoOverlayLoaded = async (page) => {
  const inputs = page.locator('input[type=file]')
  await inputs.nth(0).setInputFiles(resolve(import.meta.dirname, '..', voVideo))
  await inputs.nth(1).setInputFiles(resolve(import.meta.dirname, '..', sitl))
  await page.waitForTimeout(3000)
  await page.locator('video').evaluate((v) => {
    v.currentTime = 1
  })
  await page.waitForTimeout(1000)
  await toTop(page)
}

export const STATES = {
  'pid-review': [
    { name: 'log', files: [sitl] },
    // Three parameter sets on PIDR, so the tests table and per-set traces show.
    { name: 'param-sets', files: ['apps/pid-review/test-fixtures/ui-param-sets.bin'] }
  ],
  magfit: [
    { name: 'log', files: [sitl] },
    // Three compasses with known errors and battery current, so every fit has a result.
    { name: 'three-compasses', files: ['apps/magfit/test-fixtures/ui-three-compasses.bin'] }
  ],
  'hardware-report': [
    { name: 'log', steps: hardwareLog(files) },
    // Compasses, two barometers, GPS, parameter changes and clock drift.
    { name: 'sitl', steps: hardwareLog(sitl) },
    // Watchdog, internal errors, IOMCU, CAN nodes, missions, fences and rally points.
    { name: 'faults', steps: hardwareLog('apps/hardware-report/test-fixtures/ui-faults.bin') },
    // A parameter file: airspeed sensors and position offsets.
    { name: 'params', files: ['apps/hardware-report/test-fixtures/ui-params.param'] }
  ],
  'log-finder': [
    // Three boards with several flights each, plus the two real fixtures.
    // The row popovers (parameter changes, map, Open in) close on resize, which a full-page
    // capture triggers, so they are not captured here.
    { name: 'logs', files: logFinderFiles }
  ],
  'stream-stats': [
    { name: 'bin', files: [sitl] },
    {
      name: 'tlog',
      files: ['apps/stream-stats/test-fixtures/synthetic.tlog'],
      steps: async (page) => {
        // Open the first component's message table.
        await page.locator('details summary').first().click()
        await page.evaluate(() => window.scrollTo(0, 0))
      }
    }
  ],
  'ai-log-analyzer': MISC_STATES['ai-log-analyzer'],
  'video-overlay': [
    // A 4 s generated test video (H.264 and AAC) and the SITL log, at 1 s.
    { name: 'loaded', steps: videoOverlayLoaded },
    {
      name: 'widget-options',
      steps: async (page) => {
        await videoOverlayLoaded(page)
        await page.locator('.vo-overlay .grid-stack-item').first().dblclick()
        await page.locator('.vo-tip').first().waitFor()
        await page.waitForTimeout(1000)
      }
    },
    {
      name: 'widget-editor',
      steps: async (page) => {
        await videoOverlayLoaded(page)
        await page.locator('.vo-overlay .grid-stack-item').first().dblclick()
        await page.locator('.vo-tip').getByRole('button', { name: 'Edit' }).first().click()
        await page.waitForTimeout(2500)
      }
    },
    {
      // The export progress panel, captured while the export runs.
      name: 'exporting',
      steps: async (page) => {
        await videoOverlayLoaded(page)
        await page.getByRole('button', { name: 'Export', exact: true }).click()
        await page.locator('.vo-modal').waitFor({ timeout: 10000 })
      }
    }
  ],
  'filter-review': [
    // Synthetic batch log: two gyros logged pre and post filter, throttle and FFT notches.
    { name: 'batch', files: [filterReviewLog] },
    {
      // Log frequency axis, wrapped phase and the estimated post-filter spectrogram.
      name: 'options',
      files: [filterReviewLog],
      steps: async (page) => {
        await chip(page, 'Log')
        await chip(page, 'Wrapped')
        await chip(page, 'Estimated post')
        await page.waitForTimeout(500)
        await toTop(page)
      }
    }
  ],
  'airspeed-fit': [
    {
      name: 'log',
      files: ['apps/airspeed-fit/test-fixtures/plane-airspeed.bin'],
      steps: async (page) => {
        // The weather lookup times out offline after 5 s; let the fit settle.
        await page.waitForTimeout(3000)
      }
    }
  ],
  'analytic-tune': [
    { name: 'log', files: ['apps/analytic-tune/test-fixtures/copter-sid.bin'] },
    {
      name: 'run-2',
      files: ['apps/analytic-tune/test-fixtures/copter-sid.bin'],
      steps: async (page) => {
        await page.locator('.at-runs label.apwt-chip').nth(1).click()
        await page.waitForTimeout(1500)
        await page.evaluate(() => window.scrollTo(0, 0))
      }
    }
  ],
  'filter-tool': [
    {
      // Both harmonic notches on (throttle and ESC tracking), as a share link opens them.
      name: 'notches',
      steps: async (page) => {
        const query = new URLSearchParams({
          INS_HNTCH_ENABLE: '1',
          INS_HNTCH_MODE: '1',
          INS_HNTCH_FREQ: '80',
          INS_HNTCH_BW: '40',
          INS_HNTCH_ATT: '40',
          INS_HNTCH_REF: '0.2',
          INS_HNTCH_FM_RAT: '1',
          INS_HNTCH_HMNCS: '3',
          INS_HNTC2_ENABLE: '1',
          INS_HNTC2_MODE: '3',
          INS_HNTC2_FREQ: '120',
          INS_HNTC2_BW: '30',
          INS_HNTC2_ATT: '30',
          INS_HNTC2_REF: '1',
          INS_HNTC2_HMNCS: '1',
          INS_HNTC2_OPTS: '18',
          ShowComponents: 'true',
          PID_ShowComponents: 'true',
          filtering: 'Post'
        })
        await page.goto(`${page.url().split('?')[0]}?${query}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1000)
      }
    }
  ],
  'thrust-expo': [
    {
      name: 'example',
      steps: async (page) => {
        await page.getByRole('button', { name: 'Example' }).click()
        await page.waitForTimeout(1000)
        await page.evaluate(() => window.scrollTo(0, 0))
      }
    }
  ],
  'rotation-check': [
    {
      name: 'standard',
      steps: async (page) => {
        await page.getByRole('listbox', { name: 'Rotation' }).selectOption('10')
      }
    },
    {
      name: 'search',
      steps: async (page) => {
        await page.getByRole('searchbox', { name: 'Search rotations' }).fill('pitch90')
      }
    },
    {
      name: 'custom',
      steps: async (page) => {
        await page.getByRole('listbox', { name: 'Rotation' }).selectOption('101')
        await page.getByLabel('Roll (deg)').fill('30')
        await page.getByLabel('Pitch (deg)').fill('-20')
        await page.getByLabel('Yaw (deg)').fill('45')
        await toTop(page)
      }
    }
  ],
  'kinematic-tool': [
    { name: 'copter-pitch-rate', steps: kinematic('Copter', 'Pitch', 'Rate') },
    { name: 'copter-yaw-angle-rate', steps: kinematic('Copter', 'Yaw', 'Angle + rate') },
    { name: 'copter-yaw-rate', steps: kinematic('Copter', 'Yaw', 'Rate') },
    { name: 'plane-roll-angle', steps: kinematic('Plane', 'Roll', 'Angle') },
    { name: 'plane-pitch-rate', steps: kinematic('Plane', 'Pitch', 'Rate') }
  ],
  'scurve-tool': [
    { name: 'colour-velocity-radius', steps: scurve('Velocity', true) },
    { name: 'colour-acceleration', steps: scurve('Acceleration') },
    { name: 'colour-jerk', steps: scurve('Jerk') },
    { name: 'colour-none', steps: scurve('None') }
  ],
  'geofence-generator': [
    {
      name: 'place-search',
      steps: async (page) => {
        await geofence({ search: false })(page)
        await page.getByRole('searchbox', { name: 'Place name' }).fill('Virginia Water')
        await page.getByRole('button', { name: 'Find place' }).click()
        await page.locator('.gf-places').waitFor()
        await toTop(page)
      }
    },
    { name: 'water-bodies', steps: geofence() },
    {
      name: 'selected-fence',
      steps: async (page) => {
        await geofence()(page)
        await selectLake(page)
        await page.getByText('Show file').click()
        await toTop(page)
      }
    },
    {
      name: 'crop',
      steps: async (page) => {
        await geofence()(page)
        await page.getByRole('button', { name: 'Add crop polygon' }).click()
        await selectLake(page)
      }
    }
  ],
  'dfu-loader': MISC_STATES['dfu-loader'],
  'simple-gcs': [
    {
      // The connection settings form.
      name: 'connection-form',
      steps: async (page) => {
        await page.locator('#connectBtn').click()
        await page.getByLabel('Signing passphrase', { exact: true }).fill('example passphrase')
      }
    },
    // A scripted rover: telemetry, the vehicle, fence and mission on the map, status messages.
    { name: 'connected', steps: gcsConnected },
    {
      name: 'video-inset',
      steps: async (page) => {
        await gcsConnected(page)
        await page.getByRole('button', { name: 'Video inset' }).click()
        await page.waitForTimeout(1500)
        await toTop(page)
      }
    },
    {
      name: 'parameters',
      steps: async (page) => {
        await gcsConnected(page)
        await page.getByRole('button', { name: 'Edit parameters' }).click()
        await page.locator('.gcs-param').first().waitFor({ timeout: 15000 })
        await page.waitForTimeout(500)
      }
    },
    {
      name: 'confirm',
      steps: async (page) => {
        await gcsConnected(page)
        await page.getByRole('button', { name: 'Reboot' }).click()
      }
    }
  ],
  'telemetry-dashboard': [
    // The default layout fed by a scripted vehicle (stubbed WebSocket).
    { name: 'live', steps: dashboardLive },
    {
      name: 'connection',
      steps: async (page) => {
        await dashboardLive(page)
        await page.getByRole('button', { name: 'Connection', exact: true }).click()
        await page.waitForTimeout(400)
      }
    },
    {
      name: 'settings',
      steps: async (page) => {
        await dashboardLive(page)
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.waitForTimeout(400)
      }
    },
    { name: 'widget-options', steps: dashboardWidgetOptions },
    {
      name: 'widget-editor',
      steps: async (page) => {
        await dashboardWidgetOptions(page)
        await page.locator('.td-widget-tip').getByRole('button', { name: 'Edit widget' }).click()
        await page.waitForTimeout(3000)
      }
    },
    {
      name: 'palette',
      steps: async (page) => {
        await dashboardEdit(page)
        // A click on the dashboard itself (not on a widget) toggles the palette at the cursor. The
        // clicks on the menu widget armed upstream's toggle, so the first direct click only resets it.
        await page.locator('#dashboard').evaluate((el) => {
          const r = el.getBoundingClientRect()
          for (let i = 0; i < 2; i++)
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 3, clientY: r.top + 40 }))
        })
        await page.waitForTimeout(3000)
      }
    }
  ],
  sysid: MISC_STATES.sysid
}
