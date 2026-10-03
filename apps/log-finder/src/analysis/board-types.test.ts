import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BOARD_TYPES, boardName, parseBoardTypes } from './board-types.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('board types', () => {
  const text = readFileSync(resolve(here, '../../../../upstream/LogFinder/board_types.txt'), 'utf8')

  it('compiled table matches upstream board_types.txt', () => {
    expect([...BOARD_TYPES]).toEqual([...parseBoardTypes(text)])
  })

  it('shortens names and lets later lines win', () => {
    expect(boardName(9)).toBe('CUBE_F4')
    expect(boardName(140)).toBe('CUBEORANGE')
    expect(boardName(123456)).toBeUndefined()
    expect([...parseBoardTypes('# c\nTARGET_HW_A 5\nEXT_HW_B 6 # x\nAP_HW_C-D 7\nAP_HW_E 5\n')]).toEqual([
      [5, 'E'],
      [6, 'B'],
      [7, 'C-D']
    ])
  })
})
