import { useEffect, useState, useSyncExternalStore } from 'react'
import { Plug, Unplug, Zap } from 'lucide-react'
import {
  ControlGroup,
  ErrorBanner,
  LogInput,
  RailCard,
  Section,
  ToolPage,
  toolById,
  toolReadme,
  type LogFact
} from '@apwt/tool-shell'
import { LoaderSession } from './dfu/session.js'
import { DeviceInfo } from './ui/DeviceInfo.js'
import { FlashLog } from './ui/FlashLog.js'
import './ui/dfu.css'

const BOOTLOADERS_URL = 'https://firmware.ardupilot.org/Tools/Bootloaders/'

function createSession(): LoaderSession {
  return new LoaderSession('usb' in navigator ? navigator.usb : undefined, window.location.search)
}

export function App() {
  const [session] = useState(createSession)
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => session.start(), [session])

  const { dfuse, firmware, invalid } = state
  const firmwareFacts: LogFact[] | null = firmware
    ? [
        { label: 'File', value: firmware.name },
        { label: 'Format', value: firmware.convertedFromHex ? 'Intel HEX, converted to bin' : 'Binary' },
        { label: 'Size', value: `${firmware.data.byteLength} bytes` }
      ]
    : null

  const tool = toolById('dfu-loader')

  return (
    <ToolPage
      title="DFU Loader"
      readmeUrl={toolReadme(tool)}
      intro="Load an ArduPilot bootloader on boards that support DFU over USB. Works in Chrome and Edge, which support WebUSB."
      rail={
        <RailCard>
          <ControlGroup label="Board">
            <button
              type="button"
              className="apwt-btn apwt-btn--block"
              disabled={!state.webUsb}
              onClick={() => void session.connectClick()}
            >
              {state.connectLabel === 'Connect' ? <Plug /> : <Unplug />}
              {state.connectLabel}
            </button>
          </ControlGroup>

          {!dfuse.hidden && (
            <ControlGroup label="DfuSe">
              <label className="apwt-field">
                <span>Start address</span>
                <input
                  type="text"
                  value={dfuse.startAddress.value}
                  disabled={dfuse.startAddress.disabled}
                  title="Initial memory address to read/write from (hex)"
                  size={10}
                  spellCheck={false}
                  aria-invalid={invalid?.field === 'startAddress'}
                  onChange={(e) => session.editStartAddress(e.target.value)}
                  onBlur={() => session.commitStartAddress()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void session.pressEnter('startAddress')
                  }}
                />
              </label>
              <label className="apwt-field">
                <span>Upload size</span>
                <input
                  type="number"
                  min={1}
                  max={dfuse.uploadSize.max ?? undefined}
                  value={dfuse.uploadSize.value}
                  disabled={dfuse.uploadSize.disabled}
                  aria-invalid={invalid?.field === 'uploadSize'}
                  onChange={(e) => session.editUploadSize(e.target.value, e.target.validity.badInput)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void session.pressEnter('uploadSize')
                  }}
                />
              </label>
              {invalid && <p className="dfu-invalid">{invalid.message}</p>}
            </ControlGroup>
          )}

          <ControlGroup label="Bootloader">
            <fieldset className="dfu-file" disabled={!state.fileEnabled}>
              <LogInput
                facts={firmwareFacts}
                onFile={(f) => void session.chooseFile(f)}
                accept=".bin,.hex"
                title="Choose a bootloader"
                hint={state.fileEnabled ? 'A .bin or .hex file for your board' : 'Connect a board in DFU mode first'}
                changeLabel="Choose another file"
              />
            </fieldset>
          </ControlGroup>

          <div className="apwt-group">
            <button
              type="button"
              className="apwt-btn apwt-btn--primary apwt-btn--block"
              disabled={!state.flashEnabled || state.flashing}
              onClick={() => void session.flash()}
            >
              <Zap />
              Flash bootloader
            </button>
          </div>
        </RailCard>
      }
    >
      {state.status?.kind === 'error' ? (
        <ErrorBanner
          message={
            state.webUsb ? state.status.text : `${state.status.text} Open this page in Chrome or Edge on a desktop computer.`
          }
        />
      ) : (
        state.status && <p className="dfu-status">{state.status.text}</p>
      )}

      {(state.log.length > 0 || state.flashing) && (
        <Section
          title="Firmware download"
          help="Progress of writing the bootloader to the board (firmware download to the USB device)."
        >
          <FlashLog entries={state.log} />
        </Section>
      )}
      {state.connected && (
        <Section title="Device" help="What the board reports about its USB DFU interface.">
          <DeviceInfo info={state.connected} interfaces={state.interfaces} />
        </Section>
      )}

      {!state.connected && state.strandedDfuInfo !== '' && (
        <Section title="Device" help="What the board reported before connecting stopped.">
          <pre className="dfu-pre">{state.strandedDfuInfo.replace(/^\n/, '')}</pre>
        </Section>
      )}

      <Section title="Instructions" help="To install an ArduPilot bootloader follow these steps.">
        <ol className="apwt-steps">
          <li>Use a recent version of Chrome.</li>
          <li>Put your flight controller in DFU mode, usually by pressing a button while plugging in USB to power it on.</li>
          <li>
            Download the right ArduPilot bootloader for your device in .bin or .hex format from{' '}
            <a href={BOOTLOADERS_URL} target="_blank" rel="noopener">
              {BOOTLOADERS_URL}
            </a>
            .
          </li>
          <li>Press Connect and select your DFU interface.</li>
          <li>Choose the bootloader file.</li>
          <li>Press Flash bootloader to flash the bootloader to your device.</li>
          <li>
            On completion power cycle your flight controller and load the main firmware with Mission Planner or another ArduPilot
            compatible GCS.
          </li>
        </ol>
        <p className="apwt-section__help dfu-credit">
          Many thanks to{' '}
          <a href="https://github.com/devanlai/webdfu" target="_blank" rel="noopener">
            https://github.com/devanlai/webdfu
          </a>{' '}
          for the DFU code!
        </p>
      </Section>
    </ToolPage>
  )
}
