import { Chip } from '@apwt/tool-shell'
import { mavComponentName } from '../analysis/mavlink/messages.js'
import {
  componentKey,
  dropPercent,
  messageKey,
  versionsLabel,
  type ComponentKey,
  type MessageKey,
  type TlogSelection
} from '../analysis/stats.js'
import type { Tlog, TlogComponent } from '../analysis/tlog.js'

export interface MavlinkSystemsProps {
  tlog: Tlog
  selection: TlogSelection
  onToggleComponent: (key: ComponentKey, include: boolean) => void
  onToggleMessage: (key: MessageKey, include: boolean) => void
}

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 } as const

function Signed({ signed }: { signed: boolean }) {
  return <span className={signed ? 'apwt-badge' : 'apwt-badge apwt-badge--gray'}>{signed ? 'Signed' : 'Unsigned'}</span>
}

function ComponentCard({
  component,
  selection,
  onToggleComponent,
  onToggleMessage
}: { component: TlogComponent } & Omit<MavlinkSystemsProps, 'tlog'>) {
  const key = componentKey(component)
  const included = !selection.excludedComponents.has(key)
  const multiVersion = component.versions.size > 1
  return (
    <div className="apwt-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <strong>Component {component.componentId}</strong>
        <Chip type="checkbox" checked={included} onChange={(on) => onToggleComponent(key, on)}>
          Include
        </Chip>
      </div>
      <dl className="apwt-facts">
        <div>
          <dt>ID name</dt>
          <dd>{mavComponentName(component.componentId) ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>MAVLink version</dt>
          <dd>{versionsLabel(component.versions)}</dd>
        </div>
        <div>
          <dt>Signing</dt>
          <dd>
            <Signed signed={component.signed} />
          </dd>
        </div>
        <div>
          <dt>Dropped messages</dt>
          <dd>
            {component.dropped} / {component.received} ({dropPercent(component).toFixed(2)}%)
          </dd>
        </div>
      </dl>
      <details style={{ marginTop: 12 }}>
        <summary>Messages ({component.messages.length})</summary>
        <div className="apwt-table-wrap" style={{ marginTop: 8 }}>
          <table className="apwt-table">
            <thead>
              <tr>
                <th>Message</th>
                <th>Count</th>
                {multiVersion && <th>Version</th>}
                {component.signed && <th>Signing</th>}
                <th>Include</th>
              </tr>
            </thead>
            <tbody>
              {component.messages.map((m) => {
                const mKey = messageKey(component, m.name)
                return (
                  <tr key={m.name}>
                    <td>{m.name}</td>
                    <td>{m.time.length}</td>
                    {multiVersion && <td>{versionsLabel(m.versions)}</td>}
                    {component.signed && (
                      <td>
                        <Signed signed={m.signed} />
                      </td>
                    )}
                    <td>
                      <Chip
                        type="checkbox"
                        checked={!selection.excludedMessages.has(mKey)}
                        disabled={!included}
                        title={included ? undefined : 'The component is excluded'}
                        onChange={(on) => onToggleMessage(mKey, on)}
                      >
                        Include
                      </Chip>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/** Every system and component in a tlog, with link health and include filters (upstream "MAVLink"). */
export function MavlinkSystems({ tlog, ...rest }: MavlinkSystemsProps) {
  const systems = new Map<number, TlogComponent[]>()
  for (const c of tlog.components) systems.set(c.systemId, [...(systems.get(c.systemId) ?? []), c])
  return (
    <>
      {[...systems].map(([systemId, components]) => (
        <div key={systemId} style={{ marginBottom: 20 }}>
          <h3 className="apwt-label" style={{ margin: '0 0 10px' }}>
            System ID {systemId}
          </h3>
          <div style={GRID}>
            {components.map((c) => (
              <ComponentCard key={c.componentId} component={c} {...rest} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
