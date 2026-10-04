# Video Overlay audit

Port of `upstream/VideoOverlay/` (`VideoOverlay.js`, `WidgetEdit.js`, `Widgets/*`, `index.html`, the
default layout and palette) together with the parts of `upstream/TelemetryDashboard/Widgets/` it
subclasses (`Base_Class.js`, `SandBox.js`, `SubGrid.js`, `CustomHTML.js`) and the log parser its
widget documents import (`modules/JsDataflashParser/parser.js`). Upstream has no Readme for this
tool, so the page has no Help link.

Oracles (upstream JavaScript run side by side with the port):

- `analysis/log-info.test.ts`, `sync.test.ts`, `export-formats.test.ts`: log facts, offsets, time
  maths and format choice against functions cut out of `VideoOverlay.js`.
- `widgets/loader.test.ts`: upstream `add_widget`, `load_widgets`, `load_layout`, `init_grid`,
  `clear_grid`, `grid_set_edit`, `new_widget` in `node:vm` against the port's loader over the same
  recording fake grid (grid operations, constructions, `init`/`loadLog`, `setWidgetTime`, alerts,
  errors), for the default layout and malformed layouts.
- `widgets/options.test.ts`: upstream VideoOverlay widget constructors (with the TelemetryDashboard
  classes they extend) over a fake DOM against the port's option reading, for 24 option values per
  widget type.
- `widgets/parser-facade.test.ts`: the parser facade against upstream's `JsDataflashParser` for two
  logs and a synthetic log with every field type: `messageTypes` (keys, key order, `expressions`,
  `units`, `multipliers`, `complexFields`, `instances`; `µ` for 1e-6 and a skipped undefined-type FMTU,
  the parser's proven fixes), every field of every message and instance
  through `get`/`get_instance` (values and array types), the instanced-message read without an
  instance (upstream throws, the port returns `undefined`: proven bug #119), instance keys,
  fresh copies, `stats`, `extractStartTime`, and results created in the calling document's realm.
- `widgets/layout-file.test.ts`: bundled defaults byte-identical, file shapes.

## Inventory

| Upstream                                                                                                                    | Port                                                                                                                                         | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getFlightTime`, log duration, date, `setDefaultOffset`                                                                     | `src/analysis/log-info.ts`, `log-scan.ts`                                                                                                    | identical (oracle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `setWidgetTime` offset maths, `formatTime`, seek bar, frame step, progress text, console stats                              | `src/analysis/sync.ts`                                                                                                                       | identical (oracle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `log_offset` and `grid_rows`/`grid_columns` `onchange`                                                                      | `ui/Rail.tsx` `CommitInput`                                                                                                                  | identical: widgets are moved / the grid rebuilt on the native `change` event; the typed offset is read at each time update as upstream read the input (fixed: the offset moved widgets on every keystroke, sending NaN times while typing; the grid inputs ignored spinner steps until blur)                                                                                                                                                                                                 |
| `matchOverlaySize`                                                                                                          | `src/analysis/stage.ts`                                                                                                                      | identical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `loadCodecs`, `updateFormatSelection`, `MatchExportFormatToInput`                                                           | `analysis/export-formats.ts`, `export/mediabunny.ts`                                                                                         | identical (oracle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `exportVideo`, `renderOverlay`                                                                                              | `export/pipeline.ts`, `export/mediabunny.ts`, `OverlayController.renderOverlay`                                                              | identical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `add_widget`, `load_widgets`, `load_layout`, `new_widget`                                                                   | `widgets/loader.ts`, `OverlayController`                                                                                                     | identical (oracle). Fixed: a null widget was checked after the fit test, `widgets: null` loaded as empty instead of failing, options that were not objects were replaced by `{}` instead of reaching the constructors, a failed load ended batch mode (upstream leaves it on), and the default layout loaded synchronously inside the failed load (upstream fetched it, so it arrived afterwards and `gridSizeUpdate`'s `grid_changed = true` was overwritten)                               |
| `init_grid`, `widget_dropped`, `loadPalette`, `get_layout`, `save_layout`, `save_widget`, `gridSizeUpdate`, `handle_unload` | `OverlayController`                                                                                                                          | identical; palette tips use `innerText`/`createTextNode` of the stored values (fixed: non-string `info` was dropped)                                                                                                                                                                                                                                                                                                                                                                         |
| Log input (`log = new DataflashParser()` before `processData`)                                                              | `App.tsx`, `OverlayController.assignLog`                                                                                                     | identical (fixed: a log that failed to parse was not the one later `loadLog()` calls sent)                                                                                                                                                                                                                                                                                                                                                                                                   |
| Overlay file input                                                                                                          | `widgets/layout-file.ts`, `App.tsx`                                                                                                          | identical; read with `FileReader.readAsText` (fixed)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `WidgetBase`                                                                                                                | `widgets/widget.ts`, `widgets/options.ts`                                                                                                    | identical (oracle). Fixed: `about` kept as stored (non-object abouts were replaced), the name rendered as HTML, the form definition and content passed to Formio as stored                                                                                                                                                                                                                                                                                                                   |
| `WidgetSandBoxVideoOverlay`                                                                                                 | `widgets/frame-widgets.ts`                                                                                                                   | identical (oracle); the script is kept as stored; `init()` runs twice on load as upstream (bug below, fixed)                                                                                                                                                                                                                                                                                                                                                                                 |
| `WidgetCustomHTMLVideoOverlay`                                                                                              | `widgets/frame-widgets.ts`                                                                                                                   | identical (oracle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `WidgetSubGridVideoOverlay`                                                                                                 | `widgets/subgrid-widget.ts`                                                                                                                  | identical (oracle). Fixed: colours assigned with DOM conversion (non-strings cleared the colour), background image read as upstream, rows/columns given to Gridstack unconverted, `acceptWidgets` a function as upstream (`true` additionally required `.grid-stack-item`)                                                                                                                                                                                                                   |
| `Widgets/SandBox.html`, default Custom HTML                                                                                 | `widgets/documents.ts`                                                                                                                       | byte-identical to upstream (fixed: both had their parser import rewritten, so layouts saved by the port carried a different default document and upstream documents could not load the parser)                                                                                                                                                                                                                                                                                               |
| `modules/JsDataflashParser/parser.js` as imported by widget documents                                                       | `public/apps/modules/JsDataflashParser/parser.js` (served at the path upstream's documents import from) exporting `widgets/parser-facade.ts` | identical for the public interface (oracle). Fixed: `int16[32]` columns were `Int16Array`s (upstream: plain arrays), repeated calls returned the same cached array (a script modifying it changed later results), `messageTypes` lacked `units`/`multipliers` and used the package's unit labels, instances were listed in ascending instead of appearance order, instance numbers were matched with `Number()` instead of as property keys, results were created in the parent page's realm |
| `WidgetEdit.js`                                                                                                             | `widgets/widget-editor.ts`, `widgets/formio-setup.ts`                                                                                        | identical; the test copy is attached to the editor listener after its text is loaded (fixed: it was sent its own text and the log again)                                                                                                                                                                                                                                                                                                                                                     |
| `Default_Layout.json`, `Default_Palette.json`                                                                               | `src/defaults/`                                                                                                                              | byte-identical (tested)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Page, controls, player                                                                                                      | `src/App.tsx`, `src/ui/*`                                                                                                                    | presentation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Differences

Presentation:

- CustomBuild look: rail with Video, Log, Overlay and Export groups; preview and palette are
  `Section` cards; icons instead of Unicode glyphs on the player buttons; chips for format and
  codec choice; the seek bar's trim range in the accent colour; the trim range redraws as the
  start/end are typed (upstream on `change`; the gradient only).
- Video and log facts appear once a file is chosen; before that upstream shows empty labels.
- The widget editor overlay and the widget popup are restyled.
- Bootstrap and Formio CSS sit in a CSS cascade layer.

Conveniences that change no result:

- Export progress panel with a Cancel button; a cancelled export downloads nothing.
- The export's speed statistics (upstream `console.log`) are shown after a successful export.

Browser constraints and crashes:

- `alert()`/`confirm()` are in-page messages with the same text and choices.
- Where upstream throws and the page stops (invalid layout JSON, video without a video track,
  export errors), the port shows the error in the page; no result is produced. Upstream leaves its
  loading overlay up forever after a failed export.
- Libraries come from npm at upstream's versions; Monaco's workers are bundled; `monaco-editor`
  0.57.0 instead of `@latest`.
- Sandbox iframes use `srcdoc` with upstream's `SandBox.html` (upstream: `src`); `window.parent`
  and the parser path resolve the same way. As upstream, the page must be opened at its directory
  URL for that path to resolve.
- The parser widgets receive is a facade over `@apwt/dataflash` with upstream's public interface
  (above). Upstream's parser internals (`FMT`, `data`, `offset`, `parse_type`, `parseAtOffset`,
  `loadType`, `getModeString`, ...) are not provided; `messages` is the empty object a widget
  document's `processData(data, [])` leaves. One edge differs: upstream compared message names with `==`,
  so a number matched a numeric message name (ArduPilot names are never numeric).
- Widgets record their class name explicitly; upstream used `constructor.name`.
- html2canvas clones the page to capture it, which runs each widget's constructor without
  options. Upstream's constructors then build default content (forms, iframes, tips) in the clone;
  the port leaves clones empty. html2canvas immediately replaces every custom element clone with a
  plain `html2canvascustomelement` holding copies of the original's children, so the constructed
  content is never rendered: no frame differs, only upstream's wasted work.
- `disableOneColumnMode` is not passed to Gridstack: 10.3.1 ignores it when `true`.
- `beforeunload` uses `preventDefault()` only (`returnValue` is deprecated).
- If the browser lacks WebCodecs or `OffscreenCanvas`, the Export group says so; upstream's "Video
  export not supported by browser" message is kept.

## Upstream bugs reproduced

See `docs/upstream-bugs.md`: `[object File]` message; `Invalid DateTime` without GPS time; duration
and offset from records by file position; sandbox script run twice on load; a log that fails to parse
is still sent later; won't-fit reported before the type check; failed layouts leave earlier widgets
created and the grid in batch mode.

## Proven upstream bugs fixed

Proven to the standard in [`../bug-proofs/README.md`](../bug-proofs/README.md); verdicts, reproductions
and fix details are in [`../bug-proofs/video-overlay.md`](../bug-proofs/video-overlay.md).

- **#119** An instanced message read without an instance (`log.get('IMU', 'GyrX')`) threw a TypeError
  in upstream's parser; the port's facade returns `undefined`, like the parser's other no-data
  paths, so the default widget scripts report "Unknown log message" (`widgets/parser-facade.ts`
  `get_instance`; test `parser-facade.test.ts` "returns undefined where upstream throws ...").
- **#120** A video without an audio track stopped the video panel after the FPS; the port fills in
  resolution, duration, codec (video codec alone), start/end and export size, and matches format,
  video codec and frame rate, leaving the audio codec as it was (`App.tsx` `openVideo`,
  `analysis/export-formats.ts` `inputCodecText`, `matchSelectionToInput`; tests in
  `export-formats.test.ts` "... (proven upstream bug #120)").
- **Parser fixes in the widget log facade** (proven in
  [`../bug-proofs/js-dataflash-parser.md`](../bug-proofs/js-dataflash-parser.md), #2 and #3, and fixed in
  `@apwt/dataflash`): the facade's `messageTypes` follow the corrected parser. Multiplier 1e-6 is labelled
  with `µ` (upstream `n`: `IMU.TimeUS` `ns` → `µs`), and an FMTU for an undefined message type is skipped
  instead of abandoning every later FMTU, so its units and instances match the instances the facade takes
  from `@apwt/dataflash` (`widgets/parser-facade.ts` `MULTIPLIER_PREFIX`, `fmtuUnits`; tests
  `parser-facade.test.ts` "builds messageTypes as upstream ... µ for 1e-6 (proven bug)" and "FMTU for an
  undefined type ... skips the record where upstream abandons every later FMTU").

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in both themes, in five states: empty;
a generated 4 s test video (`test-fixtures/ui-test.mp4`, 640x360 H.264 + AAC, 108 kB, made with
ffmpeg's `testsrc2` and `sine`) with `copter-sitl.bin` and the default layout; a widget's options
popup; the widget editor; and the export progress panel during an export. Every capture was read.

Changed:

- The seek bar showed only its thumb before a video was loaded (the trim gradient is invalid
  without a duration); it now has a plain track.
- Phones: the seek bar gets its own row under the transport buttons; the palette keeps a 720 px
  grid and scrolls sideways instead of squeezing the example widgets.
- The widget editor stacks the preview above the script and form editors below 1000 px, as in
  Telemetry Dashboard; Monaco follows the page theme (upstream always `vs-dark`).
- Format, video codec and audio codec chip groups carry their own labels (all three were named
  "Export").
- The export progress label is readable (it inherited a muted colour); the panel fits phones.
- The confirmation dialog focuses OK, as `confirm()` did, puts Cancel first like the other tools,
  and Escape cancels.
- Export: html2canvas copies the page for every frame, and the sandbox widgets inside the copy
  import `parser.js` with the copy as their parent, which has no parser, so each frame threw
  `Cannot read properties of undefined (reading 'forRealm')`. The shim now hands such a copy the
  page's parser, so the copy's widgets load as upstream's did. Only html2canvas's copy is affected;
  the page's own widgets always found the parser.

Remaining known issues:

- Widget contents in the default layout keep upstream's white backgrounds and serif text.
- At phone width the stage is small (it scales to the card), so widget text is hard to read; the
  export uses the video's resolution regardless.
