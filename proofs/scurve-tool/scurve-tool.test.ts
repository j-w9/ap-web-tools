import { describe, expect, it } from 'vitest'
import { replot, type Trace } from './_harness.js'

const DT = 1 / 400

function lastPoint(target: Trace): [number, number, number] {
  return [target.x.at(-1)!, target.y.at(-1)!, target.z.at(-1)!]
}

describe('S-Curve Tool', () => {
  it('defaults: the target path ends at position 4 well before 1000 s (control)', async () => {
    const r = await replot({})
    const target = r.path[1]!
    expect(target.x.length * DT).toBeLessThan(1000)
    const [n, e, u] = lastPoint(target)
    expect(Math.hypot(n - 100, e - 250, u - 80)).toBeLessThan(1)
  })

  it('row 13: with WP_SPD, WP_SPD_UP and WP_SPD_DN at 0.1 the path stops at 1000 s, short of position 4', async () => {
    const r = await replot({ WP_SPD: '0.1', WP_SPD_UP: '0.1', WP_SPD_DN: '0.1' })
    const target = r.path[1]!
    // Exactly Math.floor(1000 / dt) samples: the loop ran out rather than breaking at wp 4.
    expect(target.x.length).toBe(Math.floor(1000 / DT))
    const [n, e, u] = lastPoint(target)
    expect(Math.hypot(n - 100, e - 250, u - 80)).toBeGreaterThan(100)
  }, 120_000)

  it('row 14: an empty first waypoint North is passed as NaN and the start of the target path is NaN', async () => {
    const r = await replot({ first_wp_x: '' })
    const target = r.path[1]!
    expect(r.path[0]!.x[0]).toBeNaN()
    expect(target.x[0]).toBeNaN()
    expect(target.x.length).toBe(30072)
    expect(target.x.filter((v) => Number.isNaN(v)).length).toBe(19842)
  })

  it('row 14: an empty WP_SPD is not NaN in the path; the target crawls and is cut at 1000 s before wp 2', async () => {
    const r = await replot({ WP_SPD: '' })
    const target = r.path[1]!
    expect(target.x.length).toBe(Math.floor(1000 / DT))
    expect(target.x.some((v) => Number.isNaN(v))).toBe(false)
    expect(r.curves).toHaveLength(1)
  }, 120_000)

  it('row 15: x is north and y is east, but the Target hover labels %{y} as N and %{x} as E', async () => {
    const r = await replot({})
    expect(r.axisTitles).toEqual({ x: 'North (m)', y: 'East (m)', z: 'Up (m)' })
    // Waypoint trace: x is the waypoints' n (first_wp_x .. last_wp_x), y their e.
    expect(r.path[0]!.x).toEqual([0, 300, 70, 100])
    expect(r.path[0]!.y).toEqual([0, 300, 35, 250])
    expect(r.path[1]!.hovertemplate).toBe(
      '<extra></extra>N = %{y:.0f} m<br>E = %{x:.0f} m<br>U = %{z:.0f} m<br>Vel = %{line.color:.2f} m/s'
    )
  })

  it('row 16: the waypoint trace has a four-entry trace-level meta and a bare %{meta} token', async () => {
    const r = await replot({})
    expect(r.path[0]!.meta).toEqual([1, 2, 3, 4])
    expect(r.path[0]!.hovertemplate).toBe('<extra></extra>WP: %{meta}<br> %{x:.0f} m<br>%{y:.0f} m<br>%{z:.0f} m')
  })

  it('row 17: a coloured path sets a colorbar title but never line.showscale', async () => {
    const r = await replot({})
    const line = r.path[1]!.line!
    expect(line.colorbar?.title).toBe('Vel Magnitude')
    expect('showscale' in line).toBe(false)
    const plain = await replot({}, { display_wp_vel: false })
    expect(plain.path[1]!.line!.showscale).toBe(false)
  })
})
