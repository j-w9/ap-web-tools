import { AlertTriangle } from 'lucide-react'
import { Section } from '@apwt/tool-shell'
import type { FirmwareInfo } from '../analysis/firmware.js'
import type { ReportWarning } from '../analysis/warnings.js'
import { Badge } from './common.js'
import { ReleaseInfo } from './ReleaseInfo.js'

/** Warnings at the top of the report, in-page. */
export function Warnings({ warnings }: { warnings: readonly ReportWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {warnings.map((w, i) => (
        <p
          key={i}
          className="apwt-error"
          role="alert"
          style={
            w.level === 'warning'
              ? { color: 'var(--yellow-text)', background: 'rgba(250, 204, 21, 0.1)', borderColor: 'rgba(250, 204, 21, 0.25)' }
              : undefined
          }
        >
          <AlertTriangle />
          <span>
            {w.message}
            {w.link !== undefined && (
              <>
                {' '}
                See the <a href={w.link}>ArduPilot documentation</a>.
              </>
            )}
          </span>
        </p>
      ))}
    </div>
  )
}

/** Firmware version and flight controller. */
export function FirmwareSection({ firmware }: { firmware: FirmwareInfo }) {
  const haveFirmware = firmware.fwString !== undefined
  const haveBoard = firmware.flightController !== undefined || firmware.boardId !== undefined
  if (!haveFirmware && !haveBoard) return null
  return (
    <Section title="Firmware and flight controller" help="Version and board as reported at boot.">
      <dl className="apwt-facts">
        {haveFirmware && (
          <div>
            <dt>Firmware</dt>
            <dd>{firmware.fwString}</dd>
          </div>
        )}
        {firmware.osString !== undefined && (
          <div>
            <dt>OS</dt>
            <dd>{firmware.osString}</dd>
          </div>
        )}
        {firmware.fwHash !== undefined && (
          <div>
            <dt>Release</dt>
            <dd>
              <ReleaseInfo hash={firmware.fwHash} />
            </dd>
          </div>
        )}
        {firmware.flightController !== undefined && (
          <div>
            <dt>Flight controller</dt>
            <dd>{firmware.flightController}</dd>
          </div>
        )}
        {firmware.boardId !== undefined && (
          <div>
            <dt>Board ID</dt>
            <dd>
              {firmware.boardId} {firmware.boardName !== undefined && <Badge tone="accent">{firmware.boardName}</Badge>}
            </dd>
          </div>
        )}
      </dl>
    </Section>
  )
}
