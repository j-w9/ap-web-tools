# Telemetry Dashboard audit

Port: `apps/telemetry-dashboard`. Upstream: `upstream/TelemetryDashboard/` (`index.html`,
`TelemetryDashboard.js`, `WidgetEdit.js`, `Widgets/*`, `SandBoxWidgets/*.json`, `Examples/*.json`,
`Default_Layout.json`) plus `modules/MAVLink/mavlink.js` (with `runtime-fixes.patch`), Gridstack
10.3.1, Formio (`formio.full.min.js`), Monaco, tippy.js 6.3.7, Bootstrap 4.6.0 and Font Awesome 6.6.0
that it loads.

Oracles (upstream JavaScript run in `node:vm` side by side with the port):

- `mavlink/legacy-message.test.ts`: random frames of every message upstream defines (all 347),
  decoded by upstream's `MAVLink20Processor.parseChar` and by the port's parser plus adapter, must be
  strictly identical (all fields, metadata, `_header`, `_msgbuf`, `_payload`, `crc`), including signed
  frames, except CUBEPILOT_FIRMWARE_UPDATE_START's `crc` (proven bug #155, asserted both ways).
- `mavlink/legacy-namespace.test.ts`: the rebuilt `mavlink20` global against upstream's: every
  numeric constant (enum entries, `*_ENUM_END`, `MAVLINK_MSG_ID_*`) with the same value and no extra
  ones, the same `map` ids and message classes, and the MAVLink Inspector's component lookup.
- `connection/connection.test.ts`: heartbeat frames (plain and signed) byte for byte against
  upstream's `heartbeat.pack()`; signed frames accepted unchecked before a key is set; unsigned
  frames after reconnecting without a passphrase (upstream refuses, the port accepts: #69); two
  connections interleaving bytes into the shared parser (upstream's result asserted; the port
  differs only by the MAVLink parser's proven #150 resync).
- `layout/loader.test.ts`: upstream `add_widget`, `load_widgets`, `load_layout` (and `init_grid`,
  `clear_grid`, `grid_set_edit`, `new_widget`) against the port's loader over the same recording
  fake grid: same grid operations, widget constructions, alerts and errors, for the default layout
  and malformed layouts.
- `widgets/options.test.ts`: upstream `Widgets/*.js` constructors over a fake DOM against the port's
  option reading, for 34 well-formed and malformed option values per widget type (about, name HTML,
  form definition and content, script, `srcdoc`, sub grid size and widgets, and thrown messages).
- `sandbox/page.test.ts`: upstream `Widgets/SandBox.html`'s script against the port's runtime and
  page drawing over one fake document, fed the same message sequences (normal use, load, syntax and
  handler errors with line snippets, retries, `handle_options`, falsy broadcasts). For proven bugs
  #159 and #160 the test asserts upstream's result and that the port's equals upstream's for the
  nearest well-behaved script (no `return 0`; the same text thrown as a string).
- `dashboard/palette-imports.test.ts`: palette example loading, including a failed file (#71).
- `layout/link.test.ts`: link compression against upstream's `compress_layout` run as written.
- `layout/layout.test.ts`: bundled layouts and widgets are upstream's files (content unchanged).

Statuses: **identical** (same behaviour, restructured code), **presentation**, **convenience**,
**browser-forced**.

## Inventory

| Upstream item                                                                                                                                                                        | Port location                                                                               | Status                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAVLink20Processor.parseChar` per byte, forward messages with `_id != -1`, `m._timeStamp = Date.now()`, `broadcast.postMessage({ MAVLink: m })` on `MAVLinkMSG`                     | `connection/connection.ts` `handleData`, `mavlink/legacy-message.ts`, `sandbox/protocol.ts` | identical (oracle); decoding by `@apwt/mavlink`, which now uses exactly upstream's definitions; objects rebuilt in `mavlink.js` shape                                                                                                                                                                                                                                                          |
| One `MAVLink20Processor` (`MAVLink` global) for the page: parser state, signing key and stream timestamps, sequence, source ids                                                      | `connection.ts` `MavlinkProcessor`, owned by `Dashboard`, shared by every menu's controller | identical (oracle); was one parser per menu (fixed in this audit)                                                                                                                                                                                                                                                                                                                              |
| `ws.onmessage` feeding `new Uint8Array(msg.data)`                                                                                                                                    | `browserSocketFactory`                                                                      | identical; text frames now fed as upstream did (fixed)                                                                                                                                                                                                                                                                                                                                         |
| `mavlink20` global in the sandbox page and for Formio scripts                                                                                                                        | `mavlink/legacy-namespace.ts`, `legacy-tables.ts`                                           | identical for constants, `map`, message classes (oracle); `*_ENUM_END` is the highest value + 1 as pymavlink (fixed: was last + 1); packing/parsing classes not provided (unused by the dashboard and its widgets)                                                                                                                                                                             |
| `setup_connect`: URL input, auto connect to `ws://127.0.0.1:56781` or `#ws=`, icon colours, `set_inputs`, guards, error closes the socket, popup hidden and URL written back on open | `ConnectionController`, `widgets/menu-panels.ts`                                            | identical; the disconnect button is re-enabled on open as upstream (fixed: it followed the inputs lock)                                                                                                                                                                                                                                                                                        |
| Heartbeat at 1 Hz with `parseInt` ids, shared sequence, signing                                                                                                                      | `ConnectionController.heartbeatFrame`                                                       | identical (oracle)                                                                                                                                                                                                                                                                                                                                                                             |
| Hash parameters and "Get link"                                                                                                                                                       | `layout/link.ts`, `menu-panels.ts`                                                          | identical (oracle)                                                                                                                                                                                                                                                                                                                                                                             |
| `get_layout` / `save_layout` / `save_widget`                                                                                                                                         | `layout/layout.ts`, `dashboard/dashboard.ts`                                                | identical; options members that are undefined (form not yet loaded) are dropped by `JSON.stringify` as upstream                                                                                                                                                                                                                                                                                |
| `add_widget`, `load_widgets`, `load_layout`, `new_widget`                                                                                                                            | `layout/loader.ts`, `Dashboard`                                                             | identical (oracle). Fixed: the port validated whole layouts before building them, which changed which layouts loaded (e.g. a string `about`, a non-object form, `widgets: null` in a sub grid, an unknown type that does not fit) and the error messages; it now reads each value when upstream did, throws the same errors at the same point, assigns the colour as upstream (null clears it) |
| `load_file`                                                                                                                                                                          | `Dashboard.loadFile`                                                                        | identical; read with `FileReader.readAsText` (fixed: was `File.text()`, which does not sniff UTF-16 BOMs); JSON that is not an object throws upstream's `in` error                                                                                                                                                                                                                             |
| `load_initial_grid`, `load_default_grid`                                                                                                                                             | `Dashboard`                                                                                 | identical                                                                                                                                                                                                                                                                                                                                                                                      |
| `init_grid` options and change tracking; settings popup inputs updated via `getElementById("settings_tip_div")`                                                                      | `Dashboard.initGrid`                                                                        | identical (fixed: the port updated the first menu's popup whether shown or not); `disableOneColumnMode` dropped (Gridstack 10 ignores `true`)                                                                                                                                                                                                                                                  |
| Edit enable, columns, rows, background colour (`rgbToHex`)                                                                                                                           | `Dashboard`, `createSettingsPanel`                                                          | identical                                                                                                                                                                                                                                                                                                                                                                                      |
| `widget_dropped`                                                                                                                                                                     | `Dashboard.widgetDropped`                                                                   | identical                                                                                                                                                                                                                                                                                                                                                                                      |
| `handle_unload`                                                                                                                                                                      | `Dashboard.handleUnload`                                                                    | identical; no crash without a menu (crash clause)                                                                                                                                                                                                                                                                                                                                              |
| Palette (`init_pallet`)                                                                                                                                                              | `dashboard/palette.ts`                                                                      | identical; tips use `innerText` for the name and `createTextNode` for `info` as upstream (fixed); `followCursor` plugin added: presentation (see below)                                                                                                                                                                                                                                        |
| `WidgetBase`                                                                                                                                                                         | `widgets/base.ts`, `widgets/options.ts`                                                     | identical (oracle). Fixed: `about` kept as stored (a string or number about was replaced), a null about throws for the menu, the form definition and content go to Formio as stored, the name is HTML (`innerHTML`) as upstream                                                                                                                                                                |
| `WidgetSandBox`                                                                                                                                                                      | `widgets/sandbox.ts`                                                                        | identical (oracle); the script is kept and saved as stored and compared with `!=` on edit (fixed)                                                                                                                                                                                                                                                                                              |
| `Widgets/SandBox.html`                                                                                                                                                               | `sandbox.html`, `sandbox/main.ts`, `sandbox/runtime.ts`, `sandbox/page.ts`                  | identical (oracle). Fixed: falsy `MAVLink` posts ignored (`if (e?.data?.MAVLink)`), a primitive script result and a thrown null/Symbol behave as upstream (bugs below), the stack of any thrown object is read                                                                                                                                                                                 |
| `WidgetCustomHTML`                                                                                                                                                                   | `widgets/custom-html.ts`                                                                    | identical (oracle)                                                                                                                                                                                                                                                                                                                                                                             |
| `WidgetSubGrid`                                                                                                                                                                      | `widgets/subgrid.ts`                                                                        | identical (oracle). Fixed: stored widgets loaded on `init` as stored (were validated in the constructor), rows/columns given to Gridstack unconverted, values compared with JavaScript `==`, background image read as upstream (`length > 0`, `[0].url`, throwing for a missing entry), style values assigned with DOM conversion, a fresh form definition per widget                          |
| `WidgetMenu`                                                                                                                                                                         | `widgets/menu.ts`, `menu-panels.ts`                                                         | identical; a re-created menu sets up a new connection and the old one stays open (bug)                                                                                                                                                                                                                                                                                                         |
| `init_editor` / `load_editor`                                                                                                                                                        | `dashboard/editor.ts`, `forms/formio-setup.ts`                                              | identical; listeners registered once and pointed at the current test widget, set after the editor text is loaded so the copy is not sent its own text (fixed: it was set before)                                                                                                                                                                                                               |
| `alert()` / `confirm()`                                                                                                                                                              | `ui/dialogs.ts`                                                                             | browser-forced policy                                                                                                                                                                                                                                                                                                                                                                          |
| `window.onerror` alert                                                                                                                                                               | `@apwt/tool-shell` `installGlobalErrorReporter`                                             | presentation                                                                                                                                                                                                                                                                                                                                                                                   |

## Differences

Presentation and browser-forced only:

1. **Page frame and styling.** CustomBuild look (`ToolPage`, dark chrome, yellow accent). The grid
   sits in a card that is one viewport tall instead of filling the window. Popups, the editor
   overlay and dialogs use the shared tokens; Formio forms keep a white background. Widget contents
   are unchanged.
2. **Icons.** Font Awesome 6 icon classes instead of inline copies of the same SVGs.
3. **Libraries from npm.** Gridstack 10.3.1, tippy.js 6.3.7, Bootstrap 4.6.0, Font Awesome 6.6.0 at
   upstream's versions; Formio 4.21.7 and Monaco 0.57.0 pinned (upstream loaded "latest" from unpkg).
   Bootstrap is in a CSS cascade layer; Formio's stylesheet is injected as text (build constraint).
4. **Sandbox page as a build entry.** `sandbox.html` is a second Vite page of this app.
5. **`alert()`/`confirm()`** are in-page dialogs with the same text and buttons.
6. **Palette position.** Upstream passed `followCursor: "initial"` without registering tippy's
   plugin, so the option was ignored and the palette opened at tippy's default placement against
   the dashboard element. The port registers the plugin, so it opens at the click. Decided
   presentation: only the popup's screen position differs; its content, the widgets offered, drag
   and drop and the toggle logic are unchanged, and no result depends on where it appears.
7. **Crash clauses.** A malformed `#ws=` address shows the browser's error instead of stopping the
   page; leaving a page without a menu no longer throws; opening the editor before the form builder
   has loaded does nothing instead of throwing; saving a sub grid whose grid was never built saves
   `{}` instead of throwing; the editor gets the stored script as text (upstream handed Monaco a
   non-string script and failed).
8. **Error panel** for uncaught errors instead of upstream's `alert` wording.

Decided and reverted to upstream in this audit: **widget name as HTML.** The porters showed the
widget name as text. Upstream used `innerHTML`, so a layout's name markup (`Speed<br>m/s`, an
icon) rendered. That is content a layout carries, not chrome, so it is reproduced. The security
reason given does not hold: sandbox iframes run layout scripts with `allow-scripts
allow-same-origin` on the dashboard's origin, so a layout can already run code there.

## Proven upstream bugs fixed

Fixed because each is proven (`docs/bug-proofs/telemetry-dashboard.md`, `docs/bug-proofs/mavlink.md`
for #155). Tests show upstream's result, the corrected result, and identity everywhere else.

- **#68 / #158 Re-created menu leaves its socket open** (so two sockets fed one parser): removing a
  menu closes its connection and heartbeat (`ConnectionController.dispose`, called from
  `MenuWidget.destroy`). Two menus that are both live still share the parser, as upstream.
- **#69 Passphrase stays active:** connecting with the field empty clears the key, so unsigned frames
  are accepted, as on a fresh page.
- **#71 Palette never initialises if an example fails:** a failed file settles
  (`dashboard/palette-imports.ts`) and is simply missing from the palette.
- **#159 Stuck sandbox after a primitive script result:** an options message returns quietly, so the
  edited script in the same message loads.
- **#160 Sandbox script throwing null (or undefined, or a Symbol) keeps running:** the report
  completes (value as text, red border) and the script stops.
- **#155 Frame checksum overwrote a field called `crc`:** CUBEPILOT_FIRMWARE_UPDATE_START's `crc` is
  the payload value in widget messages.

## Upstream bugs reproduced

See `docs/upstream-bugs.md`: `[object File]` message; settings popup updated only while shown; text
frames fed as zeros; won't-fit reported before the type check; failed layouts leave earlier widgets
created and the grid in batch mode.

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in both themes, in seven states: empty,
the default layout live, the connection and settings popups, a widget's options popup (Formio), the
widget editor (Monaco and the form builder) and the palette. The live states use a scripted copter
(`src/test-support/ui-peer.ts`) behind a stubbed `WebSocket`, sending the messages the default
layout reads (attitude, VFR_HUD, SYS_STATUS, GLOBAL_POSITION_INT, HOME_POSITION,
NAV_CONTROLLER_OUTPUT, STATUSTEXT). Every capture was read. Widget contents keep the layout's own
colours and the widget name stays HTML (decided above).

Changed (presentation only):

- Narrow screens: the grid keeps at least 960 px and scrolls sideways inside its card, with a note
  saying so, instead of squeezing a 12-column layout into 320 px (every widget was a sliver).
- The code editor follows the page theme (`vs` in light, `vs-dark` in dark; upstream always
  `vs-dark`) and switches with the theme toggle.
- Sentence case: "Widget editor", "Connection settings".

Remaining known issues:

- Every capture logs a failed connection to `ws://127.0.0.1:56781`: upstream's automatic attempt on
  start, made before the harness can install its stub (the stub needs a reload).
- At phone width popups (settings, options, palette) open where tippy places them and can cover the
  header; they stay within the viewport.
- Formio's `sr-only` spans are reported as clipped text by the harness (they are meant to be
  invisible).
