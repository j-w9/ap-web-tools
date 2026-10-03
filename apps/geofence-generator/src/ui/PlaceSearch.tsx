import { useState, type SyntheticEvent } from 'react'
import { Search } from 'lucide-react'
import { ErrorBanner } from '@apwt/tool-shell'
import type { Place } from '../analysis/places.js'
import { searchPlaces } from '../net/nominatim.js'

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching' }
  | { readonly status: 'done'; readonly places: readonly Place[] }
  | { readonly status: 'failed'; readonly error: string }

/** Place search box (upstream puts leaflet-control-geocoder on the map); picking a result moves the map. */
export function PlaceSearch({ onPick }: { onPick: (place: Place) => void }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ status: 'idle' })

  const submit = async (e: SyntheticEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q === '') return
    setState({ status: 'searching' })
    try {
      setState({ status: 'done', places: await searchPlaces(q) })
    } catch (err) {
      setState({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="gf-stack">
      <form className="gf-search" onSubmit={(e) => void submit(e)} role="search">
        <input
          className="apwt-input"
          type="search"
          value={query}
          placeholder="Town, lake or address"
          aria-label="Place name"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className="apwt-btn"
          disabled={state.status === 'searching' || query.trim() === ''}
          aria-label="Find place"
        >
          <Search />
        </button>
      </form>
      {state.status === 'searching' && <p className="gf-hint">Searching…</p>}
      {state.status === 'failed' && <ErrorBanner message={state.error} />}
      {state.status === 'done' &&
        (state.places.length === 0 ? (
          <p className="gf-hint">No places found. Try a different spelling or a nearby town.</p>
        ) : (
          <ul className="gf-places">
            {state.places.map((place) => (
              <li key={`${place.name}${String(place.bounds.south)}${String(place.bounds.west)}`}>
                <button type="button" onClick={() => onPick(place)}>
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
