// Oracle tests: upstream PIDReview.js runs in node:vm on the same logs and inputs as the port, and
// every loaded value, FFT result and plotted trace is compared exactly.
import { describe, expect, it } from 'vitest'
import { arr, compareFft, compareLoad, portFft, runScenario, spectrogramSelection, upPids } from '../test-utils/oracle.js'
import { createUpstreamPidReview, readFixture, type UpTrace } from '../test-utils/upstream.js'
import { buildPidLog, type PidLogOptions } from '../test-utils/synthetic.js'
import { WINDOW_NOT_POWER_OF_TWO, parseWindowSize } from './batch-fft.js'
import { FFT_KEYS, type FftKey } from './keys.js'
import { LoadError, NO_PID_DATA, UNSUPPORTED_VEHICLE, loadLog } from './load.js'
import { DEFAULT_SHOWN_KEYS, selectionsForAxis, validSets } from './selection.js'

describe('PID Review against upstream PIDReview.js', () => {
  it('loads the SITL fixtures identically', async () => {
    for (const name of ['copter-sitl.bin', 'copter-files.bin']) {
      const buffer = readFixture(name)
      const up = await createUpstreamPidReview({ fixed: true })
      expect(await up.load(buffer)).toBeUndefined()
      compareLoad(up, loadLog(buffer))
    }
  })

  it('analyses the SITL fixture with small windows', async () => {
    await runScenario(readFixture('copter-sitl.bin'), [
      { window: '64', action: 're_calc' },
      { window: '128', action: 're_calc' },
      { range: ['10', '30'], action: 're_calc' },
      { axis: 'RATE_P', action: 'setup_axis' }
    ])
  })

  it('splits batches at gaps and parameter changes, with jitter (copter, D FF)', async () => {
    const buffer = buildPidLog({
      duration: 40,
      jitterUs: 300,
      gaps: [
        [6, 6.2],
        [20, 20.01]
      ],
      changes: [
        { time: 10, name: 'ATC_RAT_RLL_P', value: 0.2 },
        { time: 10.5, name: 'ATC_RAT_RLL_D', value: 0.004 },
        { time: 25, name: 'ATC_RAT_RLL_I', value: 0.2 },
        { time: 25, name: 'ATC_RAT_PIT_P', value: 0.15 }
      ]
    })
    await runScenario(buffer, [
      { action: 'redraw', scale: ['linear', false, false] },
      { action: 'redraw', scale: ['PSD', true, true] },
      { action: 're_calc', window: '1024' },
      { action: 're_calc', window: '256', range: ['8', '27'] },
      { action: 'setup_axis', axis: 'PIDP' },
      { action: 'setup_axis', axis: 'RATE_R' }
    ])
  })

  it('applies an edited time range on the next redraw, without Calculate', async () => {
    const buffer = buildPidLog({ duration: 30, changes: [{ time: 15, name: 'ATC_RAT_RLL_P', value: 0.2 }] })
    await runScenario(buffer, [
      { range: ['3', '12'], action: 'none' },
      { scale: ['linear', false, false], action: 'redraw' },
      { range: ['5', '9'], action: 'none' },
      { axis: 'PIDY', action: 'setup_axis' }
    ])
  })

  it('treats empty and reversed time inputs as upstream does (parseFloat, NaN)', async () => {
    const buffer = buildPidLog({ duration: 20 })
    await runScenario(buffer, [
      { range: ['', ''], action: 're_calc' },
      { range: ['', '10'], action: 're_calc' },
      { range: ['15', '4'], action: 're_calc' },
      { range: ['2.5', '7.25'], action: 're_calc' }
    ])
  })

  it('proven upstream bug fixed: no step mean for a set with no well-excited window, where upstream keeps a stale one', async () => {
    // docs/bug-proofs/pid-review.md, row 4. Set 2 starts at 15 s; its targets are tiny until 22 s,
    // so a 15-19 s range has no window above 20 deg/s there while the full range does.
    const buffer = buildPidLog({
      duration: 30,
      quietSpans: [[15, 22]],
      changes: [{ time: 15, name: 'ATC_RAT_RLL_P', value: 0.2 }]
    })
    const script: { range: [string, string]; action: 're_calc' | 'redraw'; scale?: ['linear', false, false] }[] = [
      { range: ['0', '30'], action: 're_calc' },
      { range: ['15', '19'], action: 're_calc' },
      { range: ['15', '19'], action: 'redraw', scale: ['linear', false, false] }
    ]
    const { log, steps } = await runScenario(buffer, script)
    expect(log.axes[0]!.paramSets.sets.length).toBe(2)
    expect(steps?.[1]).toBeNull()

    // The original page still shows set 2's mean from the full-range redraw, with no individual estimates.
    const original = await createUpstreamPidReview()
    await original.load(buffer)
    for (const step of script) {
      original.element('TimeStart').value = step.range[0]
      original.element('TimeEnd').value = step.range[1]
      original.call(step.action)
    }
    const traces = original.evaluate('step_plot.data') as UpTrace[]
    expect(arr(traces[2]!.y)).toEqual([])
    expect(arr(traces[3]!.y).length).toBeGreaterThan(0)
  })

  // Proven upstream bug fixed (docs/bug-proofs/pid-review.md, row 3): compared with the page that
  // reflects the first real_len entries; the original's asymmetric array is pinned in proofs/pid-review.
  it('matches the fixed noise estimate at low logging rates', async () => {
    for (const rateHz of [40, 60, 90]) {
      const buffer = buildPidLog({ rateHz, duration: 60 })
      await runScenario(buffer, [
        { window: '64', action: 're_calc' },
        { window: '128', action: 're_calc' }
      ])
    }
  })

  it('handles logs without D FF and RATE-only controllers', async () => {
    const buffer = buildPidLog({ dff: false, duration: 20 })
    await runScenario(buffer, [
      { spec: 'P', action: 'none' },
      { axis: 'PIDP', action: 'setup_axis' },
      { axis: 'RATE_Y', action: 'setup_axis' }
    ])
  })

  it('reviews plane and rover logs', async () => {
    const plane = buildPidLog({
      buildType: 3,
      banner: 'ArduPlane V4.6.0 (1234abcd)',
      pidMessages: ['PIDR', 'PIDP', 'PIQR'],
      params: { RLL_RATE_P: 0.08, PTCH_RATE_P: 0.1, Q_A_RAT_RLL_P: 0.2 },
      stepAmplitude: 40
    })
    await runScenario(plane, [{ axis: 'PIQR', action: 'setup_axis' }])
    const rover = buildPidLog({
      buildType: 1,
      pidMessages: ['PIDS', 'PIDA'],
      rate: false,
      params: { ATC_STR_RAT_P: 0.2, ATC_SPEED_P: 0.2 }
    })
    await runScenario(rover, [{ axis: 'PIDA', action: 'setup_axis' }])
  })

  it('detects the vehicle as get_version_and_board does', async () => {
    const cases: [PidLogOptions, string | null][] = [
      // No VER: the bracketed boot banner gives the build type.
      [{ buildType: null, banner: 'ArduCopter V4.3.0 (abcdef12)' }, null],
      // Unsupported build types.
      [{ buildType: 7 }, UNSUPPORTED_VEHICLE],
      [{ buildType: 4 }, UNSUPPORTED_VEHICLE],
      // No VER and a banner without the lines that bracket it: upstream ignores the banner.
      [{ buildType: null, banner: 'ArduCopter V4.3.0 (abcdef12)', bracketed: false }, UNSUPPORTED_VEHICLE],
      // VER with an unknown build type: upstream keeps it rather than reading the banner.
      [{ buildType: 0, banner: 'ArduCopter V4.3.0 (abcdef12)' }, UNSUPPORTED_VEHICLE],
      // No VER and no banner.
      [{ buildType: null }, UNSUPPORTED_VEHICLE],
      // Copter log without any controller parameters.
      [{ params: { FOO: 1 } }, NO_PID_DATA]
    ]
    for (const [options, alert] of cases) {
      const buffer = buildPidLog({ duration: 5, ...options })
      const up = await createUpstreamPidReview({ fixed: true })
      expect(await up.load(buffer)).toBeUndefined()
      expect(up.alerts).toEqual(alert === null ? [] : [alert])
      if (alert === null) {
        compareLoad(up, loadLog(buffer))
      } else {
        expect(() => loadLog(buffer)).toThrow(LoadError)
        expect(() => loadLog(buffer)).toThrow(alert)
      }
    }
  })

  it('counts controllers without usable batches in the overall time span', async () => {
    // PIDY is logged at 1 Hz (too few samples for a batch) over a longer span than PIDR.
    const buffer = buildPidLog({
      duration: 20,
      rate: false,
      pidMessages: ['PIDR', 'PIDY'],
      spans: { PIDR: [5, 15] },
      decimate: { PIDY: 400 }
    })
    const up = await createUpstreamPidReview({ fixed: true })
    await up.load(buffer)
    const log = loadLog(buffer)
    compareLoad(up, log)
    expect(log.axes.map((a) => a.spec.key)).toEqual(['PIDR'])
    expect(log.startTime).toBeLessThan(log.axes[0]!.startTime)
  })

  it('rejects window sizes as upstream does', async () => {
    const buffer = buildPidLog({ duration: 10 })
    for (const window of ['300', '', '0', '-4', '0.5', '512.9', '1']) {
      const up = await createUpstreamPidReview({ fixed: true })
      up.element('FFTWindow_size').value = window
      const err = await up.load(buffer)
      const size = parseWindowSize(window)
      if (size === null) {
        expect(up.alerts).toEqual([WINDOW_NOT_POWER_OF_TWO])
      } else {
        expect(up.alerts).toEqual([])
        if (err === undefined) compareFft(up, portFft(loadLog(buffer), size))
        else expect(() => portFft(loadLog(buffer), size)).toThrow()
      }
    }
  })

  it('sets up selections and the Tests table as add_param_sets does', async () => {
    const buffer = buildPidLog({ dff: false, duration: 20, changes: [{ time: 10, name: 'ATC_RAT_RLL_P', value: 0.2 }] })
    const up = await createUpstreamPidReview({ fixed: true })
    await up.load(buffer)
    const log = loadLog(buffer)
    const fft = portFft(log, 512)
    let shown: ReadonlySet<FftKey> = new Set(DEFAULT_SHOWN_KEYS)
    let spectrogram: FftKey = 'Out'
    const upShown = () => new Set(FFT_KEYS.filter((k) => up.element(`PIDX_${k}`).checked))
    for (const [key, tick, spec] of [
      ['PIDR', ['P', 'Err', 'D'], 'P'],
      ['RATE_P', ['Out'], 'Tar'],
      ['PIDP', ['FF'], 'Act'],
      ['PIDR', [], 'I']
    ] as const) {
      // Tick boxes and the spectrogram radio on the current controller, then switch.
      for (const k of tick) up.element(`PIDX_${k}`).checked = true
      for (const k of FFT_KEYS) up.element(`Spec_${k}`).checked = k === spec
      shown = new Set([...shown, ...tick])
      spectrogram = spec
      for (const pid of upPids(up)) up.element(`type_${pid.id.join('_')}`).checked = pid.id.join('_') === key
      up.call('setup_axis')
      const axis = log.axes.find((a) => a.spec.key === key)!
      const next = selectionsForAxis(axis, shown, spectrogram)
      shown = next.shown
      spectrogram = next.spectrogram
      expect([...shown].sort()).toEqual([...upShown()].sort())
      expect(spectrogram).toBe(spectrogramSelection(up))
      const valid = validSets(axis, fft.get(key) ?? null)
      expect(valid).toEqual(axis.sets.map((_, i) => up.element(`set_selection_${i}`).checked))
    }
  })

  it('proven upstream bug fixed: keeps an enabled spectrogram signal on a log without D FF', async () => {
    // docs/bug-proofs/pid-review.md, row 5: the original moves a P selection to Output whenever any
    // optional signal is missing ("Change to Out on spectrogram if disabled option is set").
    const buffer = buildPidLog({ dff: false, duration: 20 })
    const log = loadLog(buffer)
    const axis = log.axes.find((a) => a.spec.key === 'PIDR')!
    for (const fixed of [false, true]) {
      const up = await createUpstreamPidReview({ fixed })
      await up.load(buffer)
      for (const k of FFT_KEYS) up.element(`Spec_${k}`).checked = k === 'P'
      for (const pid of upPids(up)) up.element(`type_${pid.id.join('_')}`).checked = pid.id.join('_') === 'PIDR'
      up.call('setup_axis')
      expect(up.element('Spec_P').disabled).toBe(false)
      expect(spectrogramSelection(up)).toBe(fixed ? 'P' : 'Out')
    }
    expect(selectionsForAxis(axis, new Set(DEFAULT_SHOWN_KEYS), 'P').spectrogram).toBe('P')
    // A selection the controller does not offer still moves to Output.
    expect(selectionsForAxis(axis, new Set(DEFAULT_SHOWN_KEYS), 'DFF').spectrogram).toBe('Out')
  })
})
