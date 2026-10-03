// Port of upstream tests/commands.test.cjs. Outcomes are typed; `label` gives upstream's strings.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../test-utils/fake-clock.js'
import { upstreamSource } from '../test-utils/upstream.js'
import { CommandAcks, type CommandOutcome } from './acks.js'

const label = (o: CommandOutcome<string>): string =>
  o.kind === 'result' ? o.result : o.kind === 'no-ack' ? 'no acknowledgement' : 'not sent'

function setup(clock = new FakeClock()) {
  const reports: [number, string][] = []
  const sent: unknown[] = []
  const acks = new CommandAcks<string>({
    clock,
    timeoutMs: 1000,
    report: (command, outcome) => reports.push([command, label(outcome)])
  })
  return { acks, reports, sent, clock }
}

describe('CommandAcks', () => {
  it('rapid mode changes send immediately and retain both ACKs, including a denial', () => {
    const { acks, reports, sent, clock } = setup()
    acks.submit(176, () => sent.push('RTL'))
    acks.submit(176, () => sent.push('LOITER'))
    expect(sent).toEqual(['RTL', 'LOITER'])
    acks.acknowledge(176, 'ACCEPTED')
    acks.acknowledge(176, 'DENIED')
    expect(reports).toEqual([
      [176, 'ACCEPTED'],
      [176, 'DENIED']
    ])
    clock.tick(2000)
    expect(reports.length).toBe(2)
  })

  it('missing ACKs report timeouts without holding up later control commands', () => {
    const { acks, reports, sent, clock } = setup()
    acks.submit(400, () => sent.push(1))
    acks.submit(400, () => sent.push(0))
    expect(sent).toEqual([1, 0])
    clock.tick(1000)
    expect(reports).toEqual([
      [400, 'no acknowledgement'],
      [400, 'no acknowledgement']
    ])
    expect(acks.acknowledge(400, 'DENIED')).toBe(false)
  })

  it('in-progress ACK extends deadline; disconnect cancels outstanding timers', () => {
    const { acks, reports, clock } = setup()
    acks.submit(400, () => {})
    clock.tick(900)
    acks.acknowledge(400, 'IN_PROGRESS', true)
    clock.tick(900)
    expect(reports.length).toBe(0)
    acks.submit(400, () => {})
    acks.clear()
    clock.tick(2000)
    expect(reports.length).toBe(0)
  })

  it('different command types progress independently and send failures are visible', () => {
    const { acks, reports, clock } = setup()
    acks.submit(400, () => {})
    expect(
      acks.submit(176, () => {
        throw Error('closed')
      })
    ).toBe(false)
    expect(reports).toEqual([[176, 'not sent']])
    expect(acks.acknowledge(400, 'ACCEPTED')).toBe(true)
    clock.tick(2000)
    expect(reports.length).toBe(2)
  })
})

describe('CommandAcks oracle (upstream SimpleGCS/commands.js in node:vm)', () => {
  interface UpstreamAcks {
    submit(command: number, send: () => void): boolean
    acknowledge(command: number, result: string, inProgress?: boolean): boolean
    clear(): void
  }

  it('reports the same outcomes and return values for random operation sequences', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let state = seed
      const random = (n: number): number => {
        state = (state * 1103515245 + 12345) % 2147483648
        return state % n
      }
      const clock = new FakeClock()
      const upstreamReports: [number, string][] = []
      const context = {
        module: { exports: {} as unknown },
        setTimeout: (fn: () => void, ms: number) => clock.after(ms, fn),
        clearTimeout: (timer: { cancel(): void } | null | undefined) => timer?.cancel()
      }
      runInNewContext(upstreamSource('SimpleGCS/commands.js'), context)
      const Upstream = context.module.exports as new (o: {
        report: (c: number, r: string) => void
        timeoutMs: number
      }) => UpstreamAcks
      const upstream = new Upstream({ report: (c, r) => upstreamReports.push([c, r]), timeoutMs: 1000 })
      const { acks, reports } = setup(clock)
      const results: [unknown, unknown][] = []
      for (let step = 0; step < 60; step++) {
        const command = [176, 400, 192][random(3)]!
        switch (random(5)) {
          case 0:
          case 1: {
            const fail = random(4) === 0
            const send = (): void => {
              if (fail) throw new Error('closed')
            }
            results.push([acks.submit(command, send), upstream.submit(command, send)])
            break
          }
          case 2: {
            const result = ['ACCEPTED', 'DENIED', 'IN_PROGRESS'][random(3)]!
            const inProgress = result === 'IN_PROGRESS'
            results.push([acks.acknowledge(command, result, inProgress), upstream.acknowledge(command, result, inProgress)])
            break
          }
          case 3:
            clock.tick(random(1200))
            break
          default:
            if (random(6) === 0) {
              acks.clear()
              upstream.clear()
            }
        }
        expect(reports).toEqual(upstreamReports)
      }
      clock.tick(5000)
      expect(reports).toEqual(upstreamReports)
      for (const [port, original] of results) expect(port).toBe(original)
    }
  })
})
