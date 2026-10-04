// Video Overlay widget documents (apps/video-overlay/src/widgets/documents.ts, upstream
// VideoOverlay/Widgets/SandBox.html and CustomHTML.js) import their log parser from
// `window.parent.location.href + '../modules/JsDataflashParser/parser.js'`, which is this file.
// It exports the parser the Video Overlay page provides (a facade over @apwt/dataflash with
// upstream's JsDataflashParser interface), creating its results in this document's realm.
// In html2canvas's copy of the page (made for every exported frame) a widget's parent is the copy,
// which has no parser of its own: hand it the page's, so the copy's widgets load as upstream's did
// instead of throwing.
if (window.parent.VideoOverlayDataflashParser === undefined && window.top !== null)
  window.parent.VideoOverlayDataflashParser = window.top.VideoOverlayDataflashParser
export default window.parent.VideoOverlayDataflashParser.forRealm(window)
