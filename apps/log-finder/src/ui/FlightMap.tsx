import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DataflashLog } from '@apwt/dataflash'
import { flightPathLatLngs } from '../analysis/summary.js'

/**
 * Map of a log's POS track (upstream `distance_format` tooltip): OpenStreetMap tiles with the
 * track drawn as a Leaflet polyline and the view fitted to it. The file is read again when the map
 * is first shown, as upstream does.
 *
 * Browser constraint: upstream's tile URL is `http://`, which browsers block on an https page as
 * mixed content; the same tiles are fetched over https.
 */
export function FlightMap({ file }: { file: File }) {
  const holder = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = holder.current
    if (el === null) return
    const map = L.map(el)
    L.tileLayer('https://{s}.tile.osm.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map)
    let live = true
    file
      .arrayBuffer()
      .then((buffer) => {
        if (!live) return
        const latlngs = flightPathLatLngs(DataflashLog.parse(buffer))
        if (latlngs === undefined) return
        const polyline = L.polyline(latlngs).addTo(map)
        map.fitBounds(polyline.getBounds())
      })
      .catch((e: unknown) => {
        if (live) setError(`Could not read ${file.name} again: ${e instanceof Error ? e.message : String(e)}`)
      })
    return () => {
      live = false
      map.remove()
    }
  }, [file])

  return (
    <div>
      {error !== null && <div style={{ padding: 8, color: 'var(--red-text)' }}>{error}</div>}
      <div ref={holder} style={{ width: 500, height: 500 }} />
    </div>
  )
}
