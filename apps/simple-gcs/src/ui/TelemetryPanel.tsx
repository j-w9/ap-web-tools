import type { SessionSnapshot } from '../session.js'
import { armedReadout, batteryReadout, currentText, satsReadout, speedText } from './telemetry-format.js'

export interface TelemetryPanelProps {
  readonly snap: SessionSnapshot
  readonly showGPSNumSats: boolean
}

/** Link status and vehicle telemetry (upstream `#telemetry` toolbar block). */
export function TelemetryPanel({ snap, showGPSNumSats }: TelemetryPanelProps) {
  const t = snap.telemetry
  const battery = batteryReadout(t)
  const armed = armedReadout(t)
  const sats = satsReadout(t)
  return (
    <div className={`gcs-telemetry${snap.stale ? ' gcs-telemetry--stale' : ''}`}>
      <div className="gcs-telemetry__link" role="status">
        {snap.linkStatus}
      </div>
      <dl className="gcs-telemetry__grid">
        <div>
          <dt>Armed</dt>
          <dd>
            <span className={`gcs-pill gcs-band-${armed.band}`}>{armed.text}</span>
          </dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{t.modeName || '—'}</dd>
        </div>
        <div>
          <dt>Battery</dt>
          <dd>
            <span className={`gcs-band-${battery.band}`}>{battery.text}</span>
            <small>{currentText(t)}</small>
          </dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{speedText(t)}</dd>
        </div>
        {showGPSNumSats && (
          <div>
            <dt>GPS</dt>
            <dd className={`gcs-band-${sats.band}`}>{sats.text}</dd>
          </div>
        )}
        <div>
          <dt>LTE</dt>
          <dd>
            {snap.lteCarrier}
            <small>{snap.lteRsrp}</small>
          </dd>
        </div>
      </dl>
    </div>
  )
}
