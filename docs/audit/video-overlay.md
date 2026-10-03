# Video Overlay audit

Port of `upstream/VideoOverlay/` (`VideoOverlay.js`, `WidgetEdit.js`, `Widgets/*`, `index.html`, the
default layout and palette) together with the parts of `upstream/TelemetryDashboard/Widgets/` it
subclasses (`Base_Class.js`, `SandBox.js`, `SubGrid.js`, `CustomHTML.js`). Upstream has no Readme for
this tool, so the page has no Help link.

## Inventory

| Upstream                                                                                                                                                                                  | Port                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `getFlightTime`, log duration, date, `setDefaultOffset`                                                                                                                                   | `src/analysis/log-info.ts` (luxon 3.4.4 as upstream), oracle-tested                       |
| `DfReader` record offsets used by `getLogDurationUS`/`setDefaultOffset`                                                                                                                   | `src/analysis/log-scan.ts`                                                                |
| `setWidgetTime` offset maths, `formatTime`, seek bar, frame step, progress text, console stats                                                                                            | `src/analysis/sync.ts`                                                                    |
| `matchOverlaySize`                                                                                                                                                                        | `src/analysis/stage.ts`                                                                   |
| `loadCodecs`, `updateFormatSelection`, `MatchExportFormatToInput`                                                                                                                         | `src/analysis/export-formats.ts` + `src/export/mediabunny.ts`                             |
| `exportVideo` (Mediabunny `Conversion` with per-frame `process`)                                                                                                                          | `src/export/pipeline.ts` (state machine) + `src/export/mediabunny.ts` (mediabunny 1.40.1) |
| `renderOverlay` (html2canvas 1.4.1 per widget)                                                                                                                                            | `OverlayController.renderOverlay`                                                         |
| Grid functions (`init_grid`, `add_widget`, `load_widgets`, `load_layout`, `widget_dropped`, `loadPalette`, `get_layout`, `save_layout`, `save_widget`, `gridSizeUpdate`, `handle_unload`) | `src/widgets/overlay-controller.ts` (gridstack 10.3.1)                                    |
| Layout/widget JSON format and file input handler                                                                                                                                          | `src/widgets/layout-file.ts`                                                              |
| `WidgetBase` (Formio form in a tippy popup, copy/delete/save/edit)                                                                                                                        | `src/widgets/widget.ts` (formiojs 4.21.7, tippy.js 6.3.7)                                 |
| `WidgetSandBox(VideoOverlay)`, `WidgetCustomHTML(VideoOverlay)`                                                                                                                           | `src/widgets/frame-widgets.ts`                                                            |
| `WidgetSubGrid(VideoOverlay)`                                                                                                                                                             | `src/widgets/subgrid-widget.ts`                                                           |
| `Widgets/SandBox.html`, default Custom HTML                                                                                                                                               | `src/widgets/documents.ts`                                                                |
| `WidgetEdit.js` (Monaco, Formio builder, test grid, colour component, `strip_component`)                                                                                                  | `src/widgets/widget-editor.ts`, `src/widgets/formio-setup.ts` (monaco-editor 0.57.0)      |
| `Default_Layout.json`, `Default_Palette.json`                                                                                                                                             | `src/defaults/` (byte-identical, tested)                                                  |
| The parser the sandbox scripts receive (`JsDataflashParser`)                                                                                                                              | `src/widgets/parser-facade.ts` over `@apwt/dataflash` (oracle-tested against upstream)    |
| Page, controls, player                                                                                                                                                                    | `src/App.tsx`, `src/ui/*`                                                                 |

The widget modules are marked as candidates to share with telemetry-dashboard.

## Differences

Presentation:

- CustomBuild look: rail with Video, Log, Overlay and Export groups; the page's preview and palette
  are `Section` cards; icons instead of Unicode glyphs on the player buttons; chips for format and
  codec choice; the seek bar's trim range is highlighted in the accent colour instead of green.
- Video and log facts appear once a file is chosen (the shared drop zone); before that upstream shows
  empty labels.
- The widget editor overlay and the widget popup are restyled; the popup buttons are inline icons.
- Bootstrap and Formio CSS, which upstream loads globally, sit in a CSS cascade layer so they do
  not restyle the shared page chrome.

Conveniences that change no result:

- Export progress is a panel with a progress bar and a Cancel button (upstream shows the
  percentage on its loading overlay and cannot be cancelled). A cancelled export downloads nothing.
- The export's speed statistics (upstream `console.log`) are shown under the preview after a
  successful export, with the file name and size.
- The rows/columns inputs apply on blur or Enter (the native `change` event upstream uses).

Browser constraints and crashes:

- `alert()`/`confirm()` are in-page messages with the same text and choices (`Widget won't fit on
Grid`, `Layout not for this tool!`, `Unable to load from: [object File]`, `Grid load failed\n…`,
  the delete confirmation).
- Where upstream throws and the page stops (unreadable log, invalid layout JSON, video without
  audio or video track, export errors), the port shows the error in the page; no result is
  produced. Upstream leaves its loading overlay up forever after a failed export.
- Libraries come from npm at upstream's versions instead of CDNs; Monaco's workers are bundled
  instead of built as `data:` URLs that `importScripts` unpkg. Upstream loads `monaco-editor@latest`;
  0.57.0 is used.
- Sandbox iframes use `srcdoc` with upstream's `SandBox.html` and take the log parser from the
  parent page, because the port does not serve upstream's `modules/JsDataflashParser/parser.js`.
  The parser object they receive is a facade over `@apwt/dataflash` with the same `get`,
  `get_instance`, `extractStartTime`, `messageTypes`, `stats` and `buffer` (oracle-tested).
  User scripts that reach into other internals of upstream's parser object will not find them.
- Widgets record their class name explicitly; upstream used `constructor.name`, which a minifier
  would rename.
- html2canvas clones the page to capture it, which constructs a fresh custom element for every
  widget. Upstream's constructors then run with no options (creating default content in the
  clone); the port keeps such clones empty. This only affects the throwaway clone.
- `disableOneColumnMode` is not passed to gridstack: 10.3.1 ignores it when `true`.
- `beforeunload` uses `preventDefault()` only (`returnValue` is deprecated).
- If the browser lacks WebCodecs or `OffscreenCanvas`, the Export group says so instead of failing
  on first use; upstream's "Video export not supported by browser" message is kept.

## Upstream bugs reproduced

See `docs/upstream-bugs.md` for the table. In this tool:

1. `VideoOverlay.js`, overlay file input: `alert("Unable to load from: " + file)` concatenates the
   `File` object, so the message is always `Unable to load from: [object File]`. Reproduce: load a
   JSON file with `{"header":{"tool":"videoOverlay"}}`.
2. `parser.js` `checkNumberOfInstances` deletes `OffsetArray`, so a widget script calling
   `log.get('IMU', 'GyrX')` (instanced message, no instance) throws. Reproduced by the facade.
3. `VideoOverlay.js` log input: without GPS time `extractStartTime()` is `undefined` and the date
   reads `Invalid DateTime`.
4. `VideoOverlay.js` video input: a video without an audio track throws at `audioTrack.codec`
   after the FPS is filled in; resolution, duration, codec and the export settings are not updated.
5. `getLogDurationUS`/`setDefaultOffset` pick the first and last record by file position, not by
   timestamp, so a log whose records are not in time order gets a duration and default offset from
   whichever records happen to be first and last in the file.
