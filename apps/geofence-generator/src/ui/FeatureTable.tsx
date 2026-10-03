import type { WaterPolygon } from '../analysis/features.js'
import { pointCount } from '../analysis/features.js'

export interface FeatureTableProps {
  polygons: readonly WaterPolygon[]
  selectedKey: string | null
  labelOf: (polygon: WaterPolygon) => string
  onSelect: (key: string) => void
}

/** Every water polygon found, as a list that mirrors clicking it on the map. */
export function FeatureTable({ polygons, selectedKey, labelOf, onSelect }: FeatureTableProps) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            <th className="gf-left">Name</th>
            <th className="gf-left">OSM</th>
            <th>Rings</th>
            <th>Points</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {polygons.map((p) => {
            const selected = p.key === selectedKey
            return (
              <tr key={p.key} className={selected ? 'gf-row-selected' : undefined}>
                <td className="gf-left gf-wrap">{labelOf(p)}</td>
                <td className="gf-left">{p.featureId}</td>
                <td>{p.rings.length}</td>
                <td>{pointCount(p.rings)}</td>
                <td>
                  <button type="button" className="apwt-btn apwt-btn--ghost" disabled={selected} onClick={() => onSelect(p.key)}>
                    {selected ? 'Selected' : 'Select'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
