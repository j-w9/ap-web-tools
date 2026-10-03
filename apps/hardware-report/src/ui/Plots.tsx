import { useMemo } from 'react'
import { PlotlyChart as Chart } from '@apwt/plot'
import { Section } from '@apwt/tool-shell'
import type { LogStats } from '../analysis/log-stats.js'
import type { PlotData } from '../analysis/report.js'
import { SubHeading, bytes } from './common.js'
import {
  PIE_LAYOUT,
  clockDriftPlot,
  logCompositionTrace,
  loggingTraces,
  performanceTraces,
  powerFlagTraces,
  stackTraces,
  temperatureTraces,
  timeLayout,
  voltageTraces
} from './traces.js'

const TEMPERATURE_LAYOUT = timeLayout('Temperature (°C)')
const VOLTAGE_LAYOUT = timeLayout('Voltage', { yaxis: { title: { text: 'Voltage' }, rangemode: 'tozero' } })
const FLAGS_LAYOUT = timeLayout('Power flags', { yaxis: { title: { text: 'Power flags' }, rangemode: 'tozero' } })
const LOAD_LAYOUT = timeLayout('Load (%)')
const MEMORY_LAYOUT = timeLayout('Free memory (bytes)')
const LOOP_LAYOUT = timeLayout('Loop rate (Hz)')
const STACK_FREE_LAYOUT = timeLayout('Free stack (bytes)')
const STACK_USED_LAYOUT = timeLayout('Stack usage (%)')
const DROPPED_LAYOUT = timeLayout('Dropped messages')
const BUFFER_LAYOUT = timeLayout('Free buffer space (bytes)')

/** Temperatures, voltages and power flags. */
export function BoardHealthSection({ plots }: { plots: PlotData }) {
  const temperature = useMemo(() => (plots.temperature ? temperatureTraces(plots.temperature) : []), [plots])
  const voltage = useMemo(() => (plots.voltage ? voltageTraces(plots.voltage) : []), [plots])
  const flags = useMemo(() => (plots.powerFlags ? powerFlagTraces(plots.powerFlags) : []), [plots])
  if (temperature.length === 0 && voltage.length === 0 && flags.length === 0) return null
  return (
    <Section title="Board health" help="Temperatures, supply voltages and power flags through the log.">
      {temperature.length > 0 && (
        <>
          <SubHeading>Temperature</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={temperature} layout={TEMPERATURE_LAYOUT} />
        </>
      )}
      {voltage.length > 0 && (
        <>
          <SubHeading>Voltage</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={voltage} layout={VOLTAGE_LAYOUT} />
        </>
      )}
      {flags.length > 0 && (
        <>
          <SubHeading>Power flags</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={flags} layout={FLAGS_LAYOUT} />
        </>
      )}
    </Section>
  )
}

/** CPU load, memory, loop rate and thread stacks. */
export function PerformanceSection({ plots }: { plots: PlotData }) {
  const perf = useMemo(() => (plots.performance ? performanceTraces(plots.performance) : null), [plots])
  const stacks = useMemo(() => stackTraces(plots.stacks), [plots])
  if (perf === null && plots.stacks.length === 0) return null
  return (
    <Section title="Performance" help="CPU load, free memory, main loop rate and thread stack usage.">
      {perf && (
        <>
          <SubHeading>Load</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={perf.load} layout={LOAD_LAYOUT} />
          <SubHeading>Free memory</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={perf.memory} layout={MEMORY_LAYOUT} />
          <SubHeading>Loop rate</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={perf.loopRate} layout={LOOP_LAYOUT} />
        </>
      )}
      {plots.stacks.length > 0 && (
        <>
          <SubHeading>Free stack per thread</SubHeading>
          <Chart className="apwt-plot" data={stacks.free} layout={STACK_FREE_LAYOUT} />
          <SubHeading>Stack usage per thread</SubHeading>
          <Chart className="apwt-plot" data={stacks.used} layout={STACK_USED_LAYOUT} />
        </>
      )}
    </Section>
  )
}

/** Logger drops and buffer, plus log composition. */
export function LoggingSection({ plots, stats }: { plots: PlotData; stats: LogStats }) {
  const logging = useMemo(() => (plots.logging ? loggingTraces(plots.logging) : null), [plots])
  const pie = useMemo(() => logCompositionTrace(stats), [stats])
  return (
    <Section
      title="Log statistics"
      help={`Total size ${bytes(stats.totalBytes)} (${stats.totalBytes} bytes). Dropped messages mean the logger could not keep up.`}
    >
      {logging && logging.dropped.length > 0 && (
        <>
          <SubHeading>Dropped messages</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={logging.dropped} layout={DROPPED_LAYOUT} />
        </>
      )}
      {logging && logging.buffer.length > 0 && (
        <>
          <SubHeading>Free buffer space</SubHeading>
          <Chart className="apwt-plot apwt-plot--short" data={logging.buffer} layout={BUFFER_LAYOUT} />
        </>
      )}
      {stats.messages.length > 0 && (
        <>
          <SubHeading>Composition</SubHeading>
          <Chart className="apwt-plot" style={{ height: 600 }} data={pie} layout={PIE_LAYOUT} />
        </>
      )}
    </Section>
  )
}

/** Flight controller clock drift against GPS time. */
export function ClockDriftSection({ plots }: { plots: PlotData }) {
  const plot = useMemo(() => (plots.clockDrift ? clockDriftPlot(plots.clockDrift) : null), [plots])
  if (plot === null) return null
  return (
    <Section
      title="Clock drift"
      help="Flight controller time against GPS time. The scale is at least ±1000 ppm so normal jitter looks small."
    >
      <Chart className="apwt-plot apwt-plot--short" data={plot.data} layout={plot.layout} />
    </Section>
  )
}
