import { useMemo } from 'react'
import { PlotlyChart as Chart } from '@apwt/plot'
import { Section } from '@apwt/tool-shell'
import type { CanInventory } from '../analysis/can.js'
import { CAN_LIMIT_NOTE, type CanRate, type UartRate } from '../analysis/data-rates.js'
import type { SerialPortConfig } from '../analysis/serial.js'
import { SubHeading, Table, hex } from './common.js'
import { ReleaseInfo } from './ReleaseInfo.js'
import { canTraces, timeLayout, uartTraces } from './traces.js'

/** DroneCAN nodes seen on the bus. */
export function CanSection({ can }: { can: CanInventory }) {
  if (can.nodes.length === 0) return null
  return (
    <Section
      title="DroneCAN nodes"
      help="Every node identity seen on the CAN buses. ArduPilot nodes are checked against official releases."
    >
      <Table head={[...(can.haveDriverNum ? ['Driver'] : []), 'Node', 'Name', 'Firmware', 'Release', 'UID']}>
        {can.nodes.map((n, i) => (
          <tr key={i}>
            {can.haveDriverNum && <td>{n.driver}</td>}
            <td>{n.nodeId}</td>
            <td style={{ textAlign: 'left' }}>{n.name}</td>
            <td>
              {n.version} ({n.hash})
            </td>
            <td style={{ textAlign: 'left' }}>{n.isArduPilot ? <ReleaseInfo hash={n.hash} /> : '–'}</td>
            <td>
              {hex(n.uid1)} {hex(n.uid2)}
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

/** Serial port configuration from parameters. */
export function SerialPortsSection({ ports }: { ports: readonly SerialPortConfig[] }) {
  if (ports.length === 0) return null
  return (
    <Section title="Serial ports" help="Protocol and baud rate of each SERIALn port.">
      <Table head={['Port', 'Protocol', 'Baud', 'Options']}>
        {ports.map((p) => (
          <tr key={p.index}>
            <td>SERIAL{p.index}</td>
            <td style={{ textAlign: 'left' }}>
              {p.protocolName} ({p.protocol})
            </td>
            <td>{p.protocol <= 0 ? '–' : (p.baud ?? '–')}</td>
            <td>{p.options === undefined || p.options === 0 ? '–' : p.options}</td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

function UartPlot({ rate }: { rate: UartRate }) {
  const data = useMemo(() => uartTraces(rate), [rate])
  return (
    <>
      <SubHeading>{rate.title}</SubHeading>
      <Chart className="apwt-plot apwt-plot--short" data={data} layout={UART_LAYOUT} />
    </>
  )
}

function CanPlot({ rate }: { rate: CanRate }) {
  const data = useMemo(() => canTraces(rate), [rate])
  return (
    <>
      <SubHeading>{rate.title}</SubHeading>
      {rate.worstCaseLimit !== undefined && <p className="apwt-section__help">{CAN_LIMIT_NOTE}</p>}
      <Chart className="apwt-plot apwt-plot--short" data={data} layout={CAN_LAYOUT} />
    </>
  )
}

const UART_LAYOUT = timeLayout('Data rate (bytes/second)')
const CAN_LAYOUT = timeLayout('Data rate (CAN frames/second)')

/** UART and CAN data rates. */
export function DataRatesSection({ uarts, cans }: { uarts: readonly UartRate[]; cans: readonly CanRate[] }) {
  if (uarts.length === 0 && cans.length === 0) return null
  return (
    <Section title="Data rates" help="Traffic on each serial port and CAN bus. The dotted line is the most the link can carry.">
      {uarts.map((u) => (
        <UartPlot key={`u${u.instance}`} rate={u} />
      ))}
      {cans.map((c) => (
        <CanPlot key={`c${c.instance}`} rate={c} />
      ))}
    </Section>
  )
}
