// Rows: "Invalid fits keep stale plot data and stay ticked (can be saved)" and
// "Recalculating resets the save priority to fit order".
import { describe, expect, it } from 'vitest'
import { createUpstreamMagfit, upstreamLoad, type UpstreamMagfit } from './_harness.js'
import { buildMagLog } from './_log.js'

/** Tick or untick a calibration checkbox of compass 1 the way its change listener does. */
function tick(up: UpstreamMagfit, group: number, kind: string, checked: boolean): void {
  up.evaluate(`(() => {
    const show = MAG_Data[0].fits[${group}].${kind}.show
    const name = fit_types.${kind} + ', ' + MAG_Data[0].fits[${group}].name
    show.checked = ${checked}
    show.dataset = { index: String(MAG_Data[0].param_selection.find((s) => s.name == name).index) }
    update_hidden(show)
  })()`)
}

function setWindow(up: UpstreamMagfit, start: string, end: string): void {
  up.element('TimeStart')['value'] = start
  up.element('TimeEnd')['value'] = end
}

/** Name of the calibration save_parameters writes for compass 1. */
function savedName(up: UpstreamMagfit): string | undefined {
  up.saved.length = 0
  up.alerts.length = 0
  up.evaluate('save_parameters()')
  return /Compass 1: (.*)\n/.exec(up.alerts[up.alerts.length - 1] ?? '')?.[1]
}

describe('MAGFit: invalid fit after recalculation', () => {
  it('keeps the previous field, error and yaw and draws them', async () => {
    const up = await createUpstreamMagfit()
    // Attitude held constant over the second half, so a 30-59 s window cannot fit iron.
    await upstreamLoad(up, await buildMagLog({ holdAttitudeFrom: 0.5 }))
    tick(up, 0, 'iron', true)
    expect(up.evaluate('MAG_Data[0].fits[0].iron.valid')).toBe(1)
    up.evaluate('__old = { ...MAG_Data[0].fits[0].iron }')

    setWindow(up, '30', '59')
    up.evaluate('calculate()')
    const iron = 'MAG_Data[0].fits[0].iron'
    expect(up.evaluate(`${iron}.valid`)).toBe(0)
    // New (invalid) parameters, but the field, error, yaw and mean error of the previous window.
    expect(up.evaluate(`${iron}.params === __old.params`)).toBe(false)
    expect(up.evaluate(`${iron}.params.diagonals`)).toEqual([0.6764606312546931, 1.2247597302551407, 1.0987796384901658])
    for (const key of ['x', 'y', 'z', 'error', 'yaw', 'mean_error']) {
      expect(up.evaluate(`${iron}.${key} === __old.${key}`), key).toBe(true)
    }
    // Still ticked (only disabled), so its traces are drawn with the stale field.
    expect(up.evaluate(`${iron}.show.checked`)).toBe(true)
    expect(up.evaluate(`${iron}.show.disabled`)).toBe(true)
    const trace = up.evaluate<{ visible: boolean; same: boolean }>(`(() => {
      const t = mag_plot.x.data.find((d) => d.name == 'Mag 1' && d.legendgrouptitle.text == 'Offsets and iron<br>No motor comp')
      return { visible: t.visible, same: t.y === __old.x }
    })()`)
    expect(trace).toEqual({ visible: true, same: true })
    const errorTrace = up.evaluate(
      `error_plot.data.find((d) => d.name == 'Mag 1' && d.legendgrouptitle.text == 'Offsets and iron<br>No motor comp').y === __old.error`
    )
    expect(errorTrace).toBe(true)
    // The same redraw leaves the invalid fit out of the mean error bars.
    expect(up.evaluate('error_bars.data[0].x')).toEqual([
      'Existing Calibration',
      'Offsets<br>No motor comp',
      'Offsets and scale<br>No motor comp',
      'Offsets<br>Battery 1 current',
      'Offsets and scale<br>Battery 1 current'
    ])

    // Unticking the default fit makes the invalid one the saved one; saving asks for confirmation.
    tick(up, 0, 'offsets', false)
    up.confirms.length = 0
    expect(savedName(up)).toBe('Offsets and iron, No motor comp')
    expect(up.confirms[0]).toBe(
      'MAG 1 params outside typical range:\nCOMPASS_DIA_X 0.6764606312546931 less than 0.8\nCOMPASS_DIA_Y 1.2247597302551407 larger than 1.2\n' +
        'COMPASS_ODI_Y -0.29052176091701115 less than -0.2\nCOMPASS_SCALE 0.7818366546505441 less than 0.8\n'
    )
    expect(up.saved[0]).toContain('COMPASS_DIA_X,0.6764606\n')
  })
})

describe('MAGFit: save priority across a recalculation', () => {
  it('saves the last ticked calibration until Calculate, then the first ticked in fit order', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, await buildMagLog())
    // Load ticks "Offsets, No motor comp"; the user then ticks "Offsets and iron, Battery 1 current".
    expect(savedName(up)).toBe('Offsets, No motor comp')
    tick(up, 1, 'iron', true)
    expect(savedName(up)).toBe('Offsets and iron, Battery 1 current')

    // Same window, same data: only the recalculation happens.
    up.evaluate('calculate()')
    expect(up.evaluate('MAG_Data[0].fits[1].iron.show.checked')).toBe(true)
    expect(savedName(up)).toBe('Offsets, No motor comp')
  })
})
