import { Download, RefreshCw } from 'lucide-react'
import { osmUrl, pointCount, type WaterPolygon } from '../analysis/features.js'
import { fencePointCount, formatWaypoints, type Fence, type FenceItem } from '../analysis/fence.js'

export interface FencePreviewProps {
  polygon: WaterPolygon
  label: string
  /** The fence the next download will write, or `null` while it is (re)generated. */
  fence: Fence | null
  /** Downloads so far; each one rotates the polygon's rings, as upstream does. */
  downloads: number
  onGenerate: () => void
  onDownload: () => void
}

const KIND_LABEL = { polygon: 'Polygon', circle: 'Circle' } as const satisfies Record<FenceItem['kind'], string>
const ROLE_LABEL = { inclusion: 'Inclusion', exclusion: 'Exclusion' } as const

function itemSize(item: FenceItem): string {
  switch (item.kind) {
    case 'polygon':
      return `${String(item.vertices.length)} points`
    case 'circle':
      return `radius ${item.radiusM.toFixed(1)} m`
  }
}

/** Details of the selected polygon, the fence generated from it and the download (upstream's popup). */
export function FencePreview({ polygon, label, fence, downloads, onGenerate, onDownload }: FencePreviewProps) {
  const text = fence === null ? null : formatWaypoints(fence)
  return (
    <>
      <dl className="apwt-facts">
        <div>
          <dt>Name</dt>
          <dd>{label}</dd>
        </div>
        <div>
          <dt>OpenStreetMap</dt>
          <dd>
            <a href={osmUrl(polygon.featureId)} target="_blank" rel="noreferrer">
              {polygon.featureId}
            </a>
          </dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{pointCount(polygon.rings)}</dd>
        </div>
        {fence !== null && (
          <div>
            <dt>Fence points</dt>
            <dd>{fencePointCount(fence)}</dd>
          </div>
        )}
      </dl>

      {fence === null ? (
        <div className="gf-actions">
          <button type="button" className="apwt-btn apwt-btn--primary" onClick={onGenerate}>
            <RefreshCw />
            Generate fence
          </button>
        </div>
      ) : (
        <>
          <div className="apwt-table-wrap gf-table">
            <table className="apwt-table">
              <thead>
                <tr>
                  <th className="gf-left">Item</th>
                  <th className="gf-left">Type</th>
                  <th className="gf-left">Role</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {fence.map((item, i) => (
                  <tr key={i}>
                    <td className="gf-left">{i + 1}</td>
                    <td className="gf-left">{KIND_LABEL[item.kind]}</td>
                    <td className="gf-left">{ROLE_LABEL[item.role]}</td>
                    <td>{itemSize(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {text !== null && (
            <>
              <div className="gf-actions">
                <button type="button" className="apwt-btn apwt-btn--primary" onClick={onDownload}>
                  <Download />
                  Download fence
                </button>
              </div>
              {downloads > 0 && (
                <p className="gf-hint">
                  As in the original tool, each download rotates the polygon&apos;s start vertex by 228 places, so the next file
                  differs slightly from the last one.
                </p>
              )}
              <details>
                <summary className="gf-hint gf-file-toggle">Show file</summary>
                <pre className="gf-file">{text}</pre>
              </details>
            </>
          )}
        </>
      )}
    </>
  )
}
