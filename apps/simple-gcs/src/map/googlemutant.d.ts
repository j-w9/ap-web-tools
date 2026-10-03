// Types for the npm package of the GoogleMutant plugin upstream loads from unpkg (0.16.0).
declare module 'leaflet.gridlayer.googlemutant' {
  import type { GridLayer, GridLayerOptions } from 'leaflet'
  export interface GoogleMutantOptions extends GridLayerOptions {
    type?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid'
  }
  export default class GoogleMutant extends GridLayer {
    constructor(options?: GoogleMutantOptions)
  }
}
