// Video Overlay widget documents (apps/video-overlay/src/widgets/documents.ts, upstream
// VideoOverlay/Widgets/SandBox.html and CustomHTML.js) import their log parser from
// `window.parent.location.href + '../modules/JsDataflashParser/parser.js'`, which is this file.
// It exports the parser the Video Overlay page provides (a facade over @apwt/dataflash with
// upstream's JsDataflashParser interface), creating its results in this document's realm.
export default window.parent.VideoOverlayDataflashParser.forRealm(window)
