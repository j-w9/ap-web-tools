import { ToolPage } from '@apwt/tool-shell'

export function App() {
  return (
    <ToolPage
      title="ArduPilot PID Review Tool"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/PIDReview/Readme.md"
      intro={
        <>
          This tool takes a .bin log with RATE or PID messages and shows the time and frequency content of the rate
          controller target, response and output. To record the full set of PID components the <b>PID</b> bit of the{' '}
          <code>LOG_BITMASK</code> parameter must be set before flying. The <code>RATE</code> log message is enabled by
          default and can also be used by this tool.
        </>
      }
    >
      <p>Port in progress.</p>
    </ToolPage>
  )
}
