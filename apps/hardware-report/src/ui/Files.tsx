import { Download } from 'lucide-react'
import { Section, downloadBytes } from '@apwt/tool-shell'
import type { EmbeddedFile } from '../analysis/files.js'
import type { SysFilesReport } from '../analysis/sys-files.js'
import { Badge, SubHeading, Table, bytes } from './common.js'

/** Files embedded in the log, as downloads. */
export function FilesSection({ files }: { files: readonly EmbeddedFile[] }) {
  if (files.length === 0) return null
  return (
    <Section title="Embedded files" help="Files the flight controller wrote into the log.">
      <Table head={['File', 'Size', '']}>
        {files.map((f) => (
          <tr key={f.name}>
            <td>
              {f.name} {f.isCrashDump && <Badge tone="bad">crash dump</Badge>}
            </td>
            <td>{bytes(f.data.length)}</td>
            <td>
              <button
                type="button"
                className="apwt-btn"
                onClick={() => downloadBytes(f.name.replace(/^.*[/@]/, ''), f.data)}
                title={`Download ${f.name}`}
              >
                <Download />
                Download
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

const n = (v: number | undefined): string => (v === undefined ? '–' : String(v))

/** Decoded `@SYS` diagnostics: serial ports, threads, timers, DMA and memory. */
export function SysFilesSection({ sys }: { sys: SysFilesReport }) {
  const any = [sys.uarts, sys.threads, sys.timers, sys.dma, sys.memory].some((x) => x !== undefined && x.length > 0)
  if (!any) return null
  return (
    <Section title="System diagnostics" help="Decoded from the @SYS files the firmware writes at the start of each log.">
      {sys.uarts && sys.uarts.length > 0 && (
        <>
          <SubHeading>Serial ports</SubHeading>
          <Table
            head={[
              'Port',
              'Device',
              'TX bytes',
              'RX bytes',
              'TX rate (B/s)',
              'RX rate (B/s)',
              'DMA',
              'Framing errors',
              'Overrun errors',
              'Noise errors',
              'Flow control'
            ]}
          >
            {sys.uarts.map((u) => (
              <tr key={u.index}>
                <td>SERIAL{u.index}</td>
                <td>{u.empty ? <Badge tone="neutral">empty</Badge> : u.device}</td>
                <td>{n(u.txBytes)}</td>
                <td>{n(u.rxBytes)}</td>
                <td>{n(u.txRate)}</td>
                <td>{n(u.rxRate)}</td>
                <td>{u.empty ? '–' : [u.txDma ? 'TX' : '', u.rxDma ? 'RX' : ''].filter((x) => x !== '').join(', ') || 'none'}</td>
                <td>{u.framingErrors ? <Badge tone="bad">{u.framingErrors}</Badge> : n(u.framingErrors)}</td>
                <td>{u.overrunErrors ? <Badge tone="bad">{u.overrunErrors}</Badge> : n(u.overrunErrors)}</td>
                <td>{u.noiseErrors ? <Badge tone="bad">{u.noiseErrors}</Badge> : n(u.noiseErrors)}</td>
                <td>{n(u.flowControl)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {sys.threads && sys.threads.length > 0 && (
        <>
          <SubHeading>Threads</SubHeading>
          <Table head={['Thread', 'Priority', 'Stack free (B)', 'Stack size (B)', 'Used']}>
            {sys.threads.map((t, i) => {
              const used = t.stackFree !== undefined && t.stackSize ? 1 - t.stackFree / t.stackSize : undefined
              return (
                <tr key={i}>
                  <td>{t.name}</td>
                  <td>{n(t.priority)}</td>
                  <td>{n(t.stackFree)}</td>
                  <td>{n(t.stackSize)}</td>
                  <td>
                    {used === undefined ? '–' : <Badge tone={used > 0.9 ? 'bad' : 'neutral'}>{(used * 100).toFixed(0)}%</Badge>}
                  </td>
                </tr>
              )
            })}
          </Table>
        </>
      )}
      {sys.timers && sys.timers.length > 0 && (
        <>
          <SubHeading>Timers</SubHeading>
          <Table head={['Timer', 'Clock (MHz)', 'Mode', 'Frequency', 'Target']}>
            {sys.timers.map((t) => (
              <tr key={t.timer}>
                <td>{t.timer}</td>
                <td>{n(t.clockMhz)}</td>
                <td>{t.mode ?? '–'}</td>
                <td>{n(t.frequency)}</td>
                <td>{n(t.target)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {sys.dma && sys.dma.length > 0 && (
        <>
          <SubHeading>DMA</SubHeading>
          <Table head={['Stream', 'Values']}>
            {sys.dma.map((d, i) => (
              <tr key={i}>
                <td>{d.stream ?? '–'}</td>
                <td title={d.raw}>
                  {Object.entries(d.values)
                    .map(([k, v]) => `${k}=${v}`)
                    .join('  ')}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {sys.memory && sys.memory.length > 0 && (
        <>
          <SubHeading>Memory</SubHeading>
          <Table head={['Start', 'Size', 'Free', 'Largest free block', 'Type']}>
            {sys.memory.map((m, i) => (
              <tr key={i}>
                <td>{m.start ?? '–'}</td>
                <td>{m.length === undefined ? '–' : bytes(m.length)}</td>
                <td>{m.free === undefined ? '–' : bytes(m.free)}</td>
                <td>{m.largest === undefined ? '–' : bytes(m.largest)}</td>
                <td>{n(m.type)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  )
}
