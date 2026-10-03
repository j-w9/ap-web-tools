// Port of upstream tests/commands.test.cjs. Outcomes are typed; `label` gives upstream's strings.
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../test-utils/fake-clock.js'
import { CommandAcks, type CommandOutcome } from './acks.js'

const label = (o: CommandOutcome<string>): string =>
  o.kind === 'result' ? o.result : o.kind === 'no-ack' ? 'no acknowledgement' : 'not sent'

function setup() {
  const clock = new FakeClock()
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
