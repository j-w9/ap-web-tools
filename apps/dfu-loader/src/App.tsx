import { useMemo, useState } from 'react'
import { Plug, Unplug, Zap } from 'lucide-react'
import { DfuProtectedSectorError, DfuSeDevice } from '@arduconfig/firmware-flash'
import {
  ControlGroup,
  ErrorBanner,
  LogInput,
  RadioChips,
  RailCard,
  Section,
  ToolPage,
  readFileAsArrayBuffer,
  toolById,
  toolReadme,
  type LogFact
} from '@apwt/tool-shell'
import { formatAddress, imageSegments, parseAddress, parseFirmwareFile, type FirmwareImage } from './analysis/image.js'
import {
  claimAlternate,
  connectDfuDevice,
  defaultAlternate,
  disconnect,
  isWebUsbSupported,
  type DfuAlternate,
  type DfuDevice
} from './usb/dfu-usb.js'
import { IDLE, type FlashState } from './ui/flash-state.js'
import { MemoryTable } from './ui/MemoryTable.js'
import { Progress } from './ui/Progress.js'
import './ui/dfu.css'

const FALLBACK_START = 0x08000000
const BOOTLOADERS_URL = 'https://firmware.ardupilot.org/Tools/Bootloaders/'

function alternateLabel(a: DfuAlternate): string {
  const name = a.name.split('/')[0]?.replace(/^@/, '').trim()
  return name !== undefined && name !== '' ? name : `Interface ${String(a.interfaceNumber)}.${String(a.alternateSetting)}`
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0')
}

export function App() {
  const [device, setDevice] = useState<DfuDevice | null>(null)
  const [alternateKey, setAlternateKey] = useState<string | null>(null)
  const [image, setImage] = useState<FirmwareImage | null>(null)
  const [startText, setStartText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<FlashState>(IDLE)

  const keyOf = (a: DfuAlternate) => `${String(a.interfaceNumber)}.${String(a.alternateSetting)}`
  const alternate = useMemo(
    () =>
      device ? (device.alternates.find((a) => keyOf(a) === alternateKey) ?? defaultAlternate(device.alternates)) : undefined,
    [device, alternateKey]
  )
  const defaultStart = alternate?.memory[0]?.start ?? FALLBACK_START
  const startAddress = startText === null ? defaultStart : parseAddress(startText)
  const busy = flash.phase === 'flashing'
  const canFlash = device !== null && alternate !== undefined && image !== null && startAddress !== null && !busy

  const connect = async () => {
    setError(null)
    try {
      const d = await connectDfuDevice()
      setDevice(d)
      setAlternateKey(null)
      setFlash(IDLE)
    } catch (e) {
      // Closing the chooser without picking a device is not an error worth showing.
      if (e instanceof DOMException && e.name === 'NotFoundError') return
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const disconnectDevice = async () => {
    if (device) await disconnect(device)
    setDevice(null)
    setFlash(IDLE)
  }

  const chooseFile = async (file: File) => {
    const parsed = parseFirmwareFile(file.name, new Uint8Array(await readFileAsArrayBuffer(file)))
    if (parsed.ok) {
      setImage(parsed.value)
      setError(null)
    } else {
      setImage(null)
      setError(parsed.error)
    }
    setFlash(IDLE)
  }

  const runFlash = async (allowProtectedSectors: boolean) => {
    if (!device || !alternate || !image || startAddress === null) return
    const segments = imageSegments(image, startAddress)
    setFlash({ phase: 'flashing', progress: null })
    const claimed = await claimAlternate(device, alternate)
    try {
      const dfu = new DfuSeDevice(claimed.usb, alternate.memory, device.transferSize)
      await dfu.flash(segments, (progress) => setFlash({ phase: 'flashing', progress }), { allowProtectedSectors })
      setFlash({ phase: 'done', deviceName: device.productName })
      // The board leaves DFU mode and re-enumerates, so this connection is finished.
      await disconnect(device)
      setDevice(null)
    } catch (e) {
      if (e instanceof DfuProtectedSectorError) setFlash({ phase: 'blocked', sectors: e.protectedSectors })
      else setFlash({ phase: 'failed', error: e instanceof Error ? e.message : String(e) })
    } finally {
      await claimed.release()
    }
  }

  const imageFacts: LogFact[] | null = image
    ? [
        { label: 'File', value: image.name },
        { label: 'Format', value: image.format === 'hex' ? 'Intel HEX' : 'Raw binary' },
        { label: 'Size', value: `${(image.size / 1024).toFixed(1)} KiB` },
        ...(image.format === 'hex' ? [{ label: 'Address', value: formatAddress(image.segments[0]?.address ?? 0) }] : [])
      ]
    : null

  const tool = toolById('dfu-loader')
  const supported = isWebUsbSupported()

  return (
    <ToolPage
      title="DFU Loader"
      readmeUrl={toolReadme(tool)}
      intro="Flash an ArduPilot bootloader to a board in USB DFU mode. Works in Chrome and Edge, which support WebUSB."
      rail={
        <RailCard>
          <ControlGroup label="Board">
            {device ? (
              <>
                <dl className="apwt-facts">
                  <div>
                    <dt>Device</dt>
                    <dd>{device.productName}</dd>
                  </div>
                  {device.manufacturerName !== '' && (
                    <div>
                      <dt>Maker</dt>
                      <dd>{device.manufacturerName}</dd>
                    </div>
                  )}
                  <div>
                    <dt>USB id</dt>
                    <dd>
                      {hex4(device.vendorId)}:{hex4(device.productId)}
                    </dd>
                  </div>
                  <div>
                    <dt>Transfer size</dt>
                    <dd>{device.transferSize} B</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="apwt-btn apwt-btn--block"
                  style={{ marginTop: 14 }}
                  disabled={busy}
                  onClick={() => void disconnectDevice()}
                >
                  <Unplug />
                  Disconnect
                </button>
              </>
            ) : (
              <button type="button" className="apwt-btn apwt-btn--block" disabled={!supported} onClick={() => void connect()}>
                <Plug />
                Connect board
              </button>
            )}
          </ControlGroup>

          {device && device.alternates.length > 1 && alternate && (
            <ControlGroup label="Interface">
              <RadioChips
                name="alternate"
                value={keyOf(alternate)}
                onChange={setAlternateKey}
                options={device.alternates.map((a) => ({ value: keyOf(a), label: alternateLabel(a) }))}
              />
            </ControlGroup>
          )}

          <ControlGroup label="Bootloader">
            <LogInput
              facts={imageFacts}
              onFile={(f) => void chooseFile(f)}
              accept=".bin,.hex"
              title="Choose a bootloader"
              hint="A .bin or .hex file for your board"
            />
          </ControlGroup>

          {image?.format === 'bin' && (
            <ControlGroup label="Start address">
              <label className="apwt-field">
                <span>Address</span>
                <input
                  type="text"
                  value={startText ?? formatAddress(defaultStart)}
                  onChange={(e) => setStartText(e.target.value)}
                  spellCheck={false}
                />
              </label>
              {startAddress === null && <p className="apwt-section__help">Enter a hexadecimal address, such as 0x08000000.</p>}
            </ControlGroup>
          )}

          <div className="apwt-group">
            <button
              type="button"
              className="apwt-btn apwt-btn--primary apwt-btn--block"
              disabled={!canFlash}
              onClick={() => void runFlash(false)}
            >
              <Zap />
              Flash bootloader
            </button>
          </div>
        </RailCard>
      }
    >
      {!supported && (
        <ErrorBanner message="This browser does not support WebUSB, so it cannot talk to a board in DFU mode. Open this page in Chrome or Edge." />
      )}
      <ErrorBanner message={error} />

      <Section title={flash.phase === 'idle' ? 'Before you start' : 'Steps'}>
        <ol className="apwt-steps">
          <li>Put the board in DFU mode, usually by holding its boot button while plugging in USB.</li>
          <li>
            Download the ArduPilot bootloader for your board, as a .bin or .hex file, from{' '}
            <a href={BOOTLOADERS_URL} target="_blank" rel="noopener">
              firmware.ardupilot.org
            </a>
            .
          </li>
          <li>Connect the board, choose the bootloader and flash it.</li>
          <li>Power cycle the board, then load the main firmware with Mission Planner or another ground station.</li>
        </ol>
      </Section>

      {flash.phase !== 'idle' && (
        <Section title="Flashing" help="Progress and result of the current flash.">
          <Progress state={flash} onFlashAnyway={() => void runFlash(true)} />
        </Section>
      )}

      {alternate && (
        <Section title="Device memory" help="The flash layout the board reports for the selected interface.">
          <MemoryTable sectors={alternate.memory} />
        </Section>
      )}
    </ToolPage>
  )
}
