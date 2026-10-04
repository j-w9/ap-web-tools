import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { COPTER_DEFAULTS, PLANE_DEFAULTS } from '../analysis/params.js'
import { DEFAULT_DEMAND, type Vehicle } from '../analysis/scenario.js'
import { Rail } from './Rail.js'

const upstreamDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream')
const noop = () => undefined

function render(vehicle: Vehicle): string {
  return renderToStaticMarkup(
    <Rail
      vehicle={vehicle}
      onVehicleChange={noop}
      copter={{ axis: 'R', mode: 'angle', demand: DEFAULT_DEMAND, params: COPTER_DEFAULTS }}
      onCopterChange={noop}
      plane={{ axis: 'R', mode: 'angle', demand: DEFAULT_DEMAND, params: PLANE_DEFAULTS }}
      onPlaneChange={noop}
    />
  )
}

// Proven help-text bugs (docs/bug-proofs/kinematic-tool.md row 4 and note): ATC_SLEW_YAW does not
// exist at the pinned firmware (moved to ATC_RATE_WPY_MAX), and ArduPlane has no ATC_ group.
describe('Parameters help: ATC_SLEW_YAW', () => {
  const tip = 'Note that in some flight modes ATC_SLEW_YAW provides secondary yaw rate limit.'

  it('upstream names ATC_SLEW_YAW on both pages', () => {
    expect(readFileSync(resolve(upstreamDir, 'KinematicTool/index.html'), 'utf8')).toContain(tip)
    expect(readFileSync(resolve(upstreamDir, 'KinematicTool/plane/index.html'), 'utf8')).toContain(tip)
  })

  it('copter help names ATC_RATE_WPY_MAX as the current parameter', () => {
    const html = render('copter')
    expect(html).toContain('<code>ATC_RATE_WPY_MAX</code> (formerly <code>ATC_SLEW_YAW</code>) is a second yaw rate limit')
  })

  it('plane help keeps the rest of the tooltip but drops the ATC_SLEW_YAW sentence', () => {
    const html = render('plane')
    expect(html).toContain(
      'The ArduPilot parameters that define the input shaping vehicle model. Rate time constant also changes for acro mode.'
    )
    expect(html).not.toContain('SLEW_YAW')
  })
})
