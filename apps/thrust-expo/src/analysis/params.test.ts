import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MOTOR_PARAM_NAMES, PARAM_METADATA } from './params.js'

interface UpstreamMetadata {
  DisplayName: string
  Description: string
  Units?: string
  Range: { low: string; high: string }
  User: string
}

describe('PARAM_METADATA', () => {
  it('matches upstream params.json', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const json = JSON.parse(readFileSync(resolve(here, '../../../../upstream/ThrustExpo/params.json'), 'utf8')) as {
      MOT_: Record<string, UpstreamMetadata>
    }
    expect(Object.keys(json.MOT_).sort()).toEqual([...MOTOR_PARAM_NAMES].sort())
    for (const name of MOTOR_PARAM_NAMES) {
      const up = json.MOT_[name]!
      const ours = PARAM_METADATA[name]
      expect(ours.displayName).toBe(up.DisplayName)
      expect(ours.description).toBe(up.Description)
      expect('units' in ours ? ours.units : undefined).toBe(up.Units)
      expect(ours.range).toEqual({ low: Number(up.Range.low), high: Number(up.Range.high) })
      expect(ours.user).toBe(up.User)
    }
  })
})
