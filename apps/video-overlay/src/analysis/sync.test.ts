import { describe, expect, it } from 'vitest'
import {
  exportFrameVideoTimeS,
  exportProgressFraction,
  exportProgressText,
  exportStats,
  exportStatsText,
  formatPlayerTime,
  frameStepS,
  logTimeAtVideoTime,
  offsetTextFromSeconds,
  seekFraction,
  seekTime,
  trimRangePercent
} from './sync.js'
import { stageSize } from './stage.js'
import { upstreamFunction } from '../test-utils/upstream.js'

describe('video to log time', () => {
  it('subtracts the offset (upstream setWidgetTime: logTime = vidTime - offset)', () => {
    expect(logTimeAtVideoTime(10, '2.5')).toBe(7.5)
    expect(logTimeAtVideoTime(0, '-123.456789')).toBeCloseTo(123.456789, 12)
  })

  it('parses the offset text like parseFloat, NaN for an empty input', () => {
    expect(logTimeAtVideoTime(3, '1.5e1')).toBe(-12)
    expect(logTimeAtVideoTime(3, '2abc')).toBe(1)
    expect(logTimeAtVideoTime(3, '')).toBeNaN()
  })

  it('shows a computed default offset as the number input would', () => {
    expect(offsetTextFromSeconds(-1.000123)).toBe('-1.000123')
    expect(offsetTextFromSeconds(0)).toBe('0')
  })

  it('maps an exported frame back to video time by adding the trim start', () => {
    expect(exportFrameVideoTimeS(1.25, 10)).toBe(11.25)
    expect(logTimeAtVideoTime(exportFrameVideoTimeS(0, 10), '-100')).toBe(110)
  })
})

describe('export progress and statistics', () => {
  it('formats progress as upstream does', () => {
    expect(exportProgressText(2.5, 10, 20)).toBe('25.00%')
    expect(exportProgressFraction(2.5, 10, 20)).toBe(0.25)
  })

  it('computes and prints the console statistics line', () => {
    const stats = exportStats(5, 10, 20, 30)
    expect(stats).toEqual({ exportTimeS: 5, exportFps: 60, timeRatio: 2 })
    expect(exportStatsText(stats)).toBe('Export took: 5.00s, 60.00 FPS, 200.00% realtime')
  })
})

describe('player', () => {
  it('formats time like upstream formatTime', () => {
    const upstream = upstreamFunction('VideoOverlay/VideoOverlay.js', 'formatTime') as (t: number) => string
    for (const t of [0, 5.9, 59.99, 60, 61.5, 3599, 3600, 7322.4]) expect(formatPlayerTime(t), String(t)).toBe(upstream(t))
  })

  it('treats a missing duration as 1 for the seek bar and steps by one frame', () => {
    expect(seekFraction(3, Number.NaN)).toBe(3)
    expect(seekFraction(3, 12)).toBe(0.25)
    expect(seekTime(0.5, 12)).toBe(6)
    expect(frameStepS('25')).toBe(0.04)
  })

  it('places the trim range on the seek bar', () => {
    expect(trimRangePercent('2', '8', 10)).toEqual({ start: 20, end: 80 })
  })
})

describe('stage size', () => {
  it('fits the video aspect in the available box, 16:9 before a video loads', () => {
    expect(stageSize(1200, 800, 1920, 1080)).toEqual({ width: 1200, height: 675 })
    expect(stageSize(1200, 500, 1920, 1080)).toEqual({ width: 888, height: 500 })
    expect(stageSize(1000, 1000, Number.NaN, Number.NaN)).toEqual({ width: 1000, height: 562 })
  })
})
