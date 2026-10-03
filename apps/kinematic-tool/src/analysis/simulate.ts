/** One entry point for both vehicles. */
import type { ControlLib } from '../wasm/control.js'
import type { RuckigLib } from '../wasm/ruckig-planner.js'
import { simulateCopter, type CopterResult, type CopterSettings } from './copter.js'
import { simulatePlane, type PlaneResult, type PlaneSettings } from './plane.js'

export type SimulationSettings = CopterSettings | PlaneSettings
export type SimulationResult = CopterResult | PlaneResult

export function simulate(libs: { control: ControlLib; ruckig: RuckigLib }, settings: SimulationSettings): SimulationResult {
  switch (settings.vehicle) {
    case 'copter':
      return simulateCopter(libs, settings)
    case 'plane':
      return simulatePlane(libs.control, settings)
  }
}
