import { useState } from 'react'
import {
  ControlGroup,
  ErrorBanner,
  LogInput,
  OpenInButton,
  RailCard,
  Section,
  ToolPage,
  useLoading,
  useLogFile,
  type LogFact
} from '@apwt/tool-shell'
import { loadHardwareReport, type HardwareReport } from './analysis/report.js'
import { bytes } from './ui/common.js'
import { CanSection, DataRatesSection, SerialPortsSection } from './ui/Comms.js'
import { InternalErrorsSection, IomcuSection, WatchdogSection } from './ui/Faults.js'
import { FilesSection, SysFilesSection } from './ui/Files.js'
import { MissionsSection } from './ui/Missions.js'
import { ParamChangesSection, ParamExportSection } from './ui/Params.js'
import { BoardHealthSection, ClockDriftSection, LoggingSection, PerformanceSection } from './ui/Plots.js'
import {
  AirspeedSection,
  BaroSection,
  CompassSection,
  GpsSection,
  InsSection,
  OffsetsSection,
  OtherSensorsSection
} from './ui/Sensors.js'
import { FirmwareSection, Warnings } from './ui/Summary.js'

interface Loaded {
  report: HardwareReport
  fileName: string | null
  messageTypes: readonly string[] | null
}

function facts(loaded: Loaded): LogFact[] {
  const { report, fileName } = loaded
  const out: LogFact[] = [{ label: 'File', value: fileName ?? 'From another tool' }]
  if (report.source === 'log') {
    if (report.firmware.fwString !== undefined) out.push({ label: 'Firmware', value: report.firmware.fwString })
    const board = report.firmware.boardName ?? report.firmware.flightController?.split(' ')[0]
    if (board !== undefined) out.push({ label: 'Board', value: board })
    out.push({ label: 'Size', value: bytes(report.logStats.totalBytes) })
  } else {
    out.push({ label: 'Source', value: 'Parameter file' })
  }
  out.push({ label: 'Parameters', value: String(report.params.values.size) })
  if (report.warnings.length > 0) out.push({ label: 'Warnings', value: String(report.warnings.length) })
  return out
}

export function App() {
  const { run } = useLoading()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      try {
        // Hand-offs from other tools carry no name and are always logs.
        const report = loadHardwareReport(name ?? 'log.bin', buffer)
        setLoaded({
          report,
          fileName: name,
          messageTypes: report.source === 'log' ? report.logStats.messages.map((m) => m.name) : null
        })
        setError(null)
        document.title = name ? `Hardware Report: ${name}` : 'Hardware Report'
      } catch (e) {
        setLoaded(null)
        setError(e instanceof Error ? `${e.message}. Open a log that contains parameters, or a .param file.` : String(e))
      }
    }, 'Reading file')
  })

  const report = loaded?.report ?? null
  const log = report?.source === 'log' ? report : null

  return (
    <ToolPage
      title="Hardware Report"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/HardwareReport/Readme.md"
      intro={
        <>
          Everything a log or parameter file says about the hardware: firmware, sensors and their health, CAN nodes, serial ports,
          board health and performance. Also exports parameters without calibrations for sharing.
        </>
      }
      actions={<OpenInButton file={log ? file : null} messageTypes={loaded?.messageTypes ?? null} />}
      rail={
        <RailCard>
          <ControlGroup label="Log or parameters">
            <LogInput
              changeLabel="Open another file"
              facts={loaded ? facts(loaded) : null}
              onFile={openFile}
              accept=".bin,.param,.parm"
              title="Open a log or parameter file"
              hint="Logs give sensor health, plots and files as well"
            />
          </ControlGroup>
        </RailCard>
      }
    >
      <ErrorBanner message={error} />
      {report === null ? (
        !error && (
          <Section title="Report" help="Open a .bin log or a .param file to see the hardware report.">
            <div className="apwt-empty">No file loaded yet</div>
          </Section>
        )
      ) : (
        <>
          <Warnings warnings={report.warnings} />
          {log && <FirmwareSection firmware={log.firmware} />}
          {log && <WatchdogSection watchdogs={log.watchdogs} />}
          {log && <InternalErrorsSection errors={log.internalErrors} />}
          {log && <IomcuSection iomcu={log.iomcu} />}
          <InsSection ins={report.sensors.ins} />
          <CompassSection compass={report.sensors.compass} />
          <BaroSection baro={report.sensors.baro} />
          <GpsSection gps={report.sensors.gps} />
          <AirspeedSection airspeed={report.sensors.airspeed} />
          <OtherSensorsSection sensors={report.sensors} />
          <OffsetsSection offsets={report.positionOffsets} />
          {log && <CanSection can={log.can} />}
          <SerialPortsSection ports={report.serialPorts} />
          <ParamExportSection key={loaded?.fileName ?? ''} params={report.params} fileName={loaded?.fileName ?? null} />
          <ParamChangesSection changes={report.paramChanges} />
          {log && <MissionsSection missions={log.missions} />}
          {log && <FilesSection files={log.files} />}
          {log && <SysFilesSection sys={log.sysFiles} />}
          {log && <BoardHealthSection plots={log.plots} />}
          {log && <PerformanceSection plots={log.plots} />}
          {log && <DataRatesSection uarts={log.plots.uartRates} cans={log.plots.canRates} />}
          {log && <LoggingSection plots={log.plots} stats={log.logStats} />}
          {log && <ClockDriftSection plots={log.plots} />}
        </>
      )}
    </ToolPage>
  )
}
