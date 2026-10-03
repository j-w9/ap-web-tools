// osmtogeojson ships typings for its main entry only; the browser build upstream loads from unpkg
// (`osmtogeojson/osmtogeojson.js`, the same file in the npm package) exports the same function.
declare module 'osmtogeojson/osmtogeojson.js' {
  import osmtogeojson from 'osmtogeojson'
  export default osmtogeojson
}
