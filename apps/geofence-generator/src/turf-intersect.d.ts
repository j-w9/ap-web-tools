// @turf/intersect 6.5.0 (the version in upstream's `@turf/turf@6` bundle) ships typings that its
// package.json "exports" map hides from TypeScript's bundler resolution; this restates them with
// the `geojson` types.
declare module '@turf/intersect' {
  import type { Feature, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson'
  export default function intersect<P = GeoJsonProperties>(
    poly1: Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon,
    poly2: Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon,
    options?: { properties?: P }
  ): Feature<Polygon | MultiPolygon, P> | null
}
