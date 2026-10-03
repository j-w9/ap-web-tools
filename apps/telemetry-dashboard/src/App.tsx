import { useEffect, useRef } from 'react'
import { Section, ToolPage } from '@apwt/tool-shell'
import { startDashboard } from './start.js'

export function App() {
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (gridRef.current !== null) startDashboard(gridRef.current)
  }, [])

  return (
    <ToolPage
      title="Telemetry Dashboard"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/TelemetryDashboard/Readme.md"
      intro={
        <>
          Customisable widgets showing live MAVLink telemetry from a WebSocket (it tries Mission Planner at{' '}
          <code>ws://127.0.0.1:56781</code> on start). Display only: this is not a GCS, use it alongside one.
        </>
      }
    >
      <Section
        title="Dashboard"
        help="Connect and change settings from the menu widget. Enable widget edit in its settings to move, resize and add widgets: double click a widget for its options, click empty space for the palette."
      >
        <div className="td-dashboard-frame">
          <div ref={gridRef} id="dashboard" className="grid-stack td-dashboard" />
        </div>
      </Section>
    </ToolPage>
  )
}
