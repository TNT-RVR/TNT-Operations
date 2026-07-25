// shpjs ships no types. It takes a zipped shapefile (ArrayBuffer) or a URL and
// resolves to GeoJSON — a FeatureCollection, or an array of them for multi-layer.
declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'
  const shp: (input: ArrayBuffer | string) => Promise<FeatureCollection | FeatureCollection[]>
  export default shp
}
