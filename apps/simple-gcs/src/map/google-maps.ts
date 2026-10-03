/** Google Maps JavaScript API loader (upstream `SimpleGCS/util.js`, `GMapsLoader`). */

let loadPromise: Promise<void> | null = null

const hasGoogleMaps = (): boolean =>
  typeof Reflect.get(window, 'google') === 'object' && Reflect.has(Reflect.get(window, 'google') as object, 'maps')

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (hasGoogleMaps()) return Promise.resolve()
  if (loadPromise !== null) return loadPromise
  loadPromise = new Promise<void>((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('GMAPS_API_KEY missing'))
      return
    }
    // Set up the callback before creating the script.
    Reflect.set(window, '__onGMapsLoaded', () => {
      Reflect.deleteProperty(window, '__onGMapsLoaded')
      resolve()
    })
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async&callback=__onGMapsLoaded`
    s.async = true
    s.defer = true
    s.onerror = (e) => {
      Reflect.deleteProperty(window, '__onGMapsLoaded')
      loadPromise = null
      reject(e instanceof Event ? new Error('Google Maps failed to load') : new Error(e))
    }
    document.head.appendChild(s)
  })
  return loadPromise
}
