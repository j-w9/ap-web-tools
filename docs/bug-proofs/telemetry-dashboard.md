# Telemetry Dashboard: bug proofs

Verdicts for the Telemetry Dashboard rows of [`../upstream-bugs.md`](../upstream-bugs.md), under the standard in
[`README.md`](README.md). The reproductions are in `proofs/telemetry-dashboard/` (`connection.test.ts`,
`dashboard.test.ts`, `sandbox.test.ts`). They run the original `upstream/TelemetryDashboard/TelemetryDashboard.js`,
`Widgets/Base_Class.js`, `Widgets/Menu.js` and the module script of `Widgets/SandBox.html` in `node:vm`, with the
original `upstream/modules/MAVLink/mavlink.js` where frames are parsed. The DOM, tippy, GridStack, Formio, WebSocket,
`fetch`, `FileReader` and BroadcastChannel are recording fakes, and nothing touches the network. Line numbers are in
`upstream/TelemetryDashboard/` unless a path says otherwise.

| Row | Bug                                                                           | Verdict    |
| --- | ----------------------------------------------------------------------------- | ---------- |
| 68  | A re-created menu widget opens a second connection and never closes the first | PROVEN     |
| 69  | A signing passphrase stays active for later connections                       | PROVEN     |
| 70  | Unrecognised file message shows `[object File]`                               | NOT PROVEN |
| 71  | Palette never initialises if one example widget fails to load                 | PROVEN     |
| 158 | Two open connections feed one MAVLink parser                                  | PROVEN     |
| 159 | A sandbox script that returns a primitive can no longer be edited             | PROVEN     |
| 160 | A sandbox script that throws null keeps running and keeps failing             | PROVEN     |
| 161 | The settings popup is updated only while it is shown                          | NOT PROVEN |
| 162 | Text WebSocket frames are fed to the parser as zero bytes                     | NOT PROVEN |
| 163 | A widget that won't fit is reported before its type is checked                | NOT PROVEN |
| 164 | A failed layout leaves earlier widgets created and the grid in batch mode     | NOT PROVEN |

PROVEN 6, NOT PROVEN 5. Rows 158 and 68 have the same cause and need only one fix. Row 161 is partly mis-described (see
its section).

## 68. A re-created menu widget opens a second connection and never closes the first

**Row:** `Widgets/Menu.js` `init` → `setup_connect`; `destroy` does not disconnect. Changing Rows or loading a layout
re-creates the menu. The new menu auto-connects again while the old socket stays open.

**Verdict:** PROVEN (it fails: after the menu is re-created, the page's Disconnect button no longer stops the data).

**Tests:** `#68 … destroying a menu leaves its socket open; the new menu Disconnect cannot close it` and
`#68 … with both sockets connected every message reaches the widgets twice`. The test runs
`m1 = new WidgetMenu({}); m1.init(); m1.destroy(); m2 = new WidgetMenu({}); m2.init()`, which is what `clear_grid` and
`load_widgets` do on a reload. This opens two sockets to `ws://127.0.0.1:56781`, and `m1.destroy()` closes neither.
Clicking the only remaining menu's Disconnect closes socket 2. Socket 1 stays `OPEN`, and a HEARTBEAT on it is still
broadcast to the widgets (`['HEARTBEAT']`). With both sockets open, one forwarded frame on each gives
`['HEARTBEAT', 'HEARTBEAT']`.

**Evidence:**

- `TelemetryDashboard.js:126`: `let ws = null`. The socket exists only inside one `setup_connect` closure, and only
  that closure's `disconnect()` (`:243-256`) and buttons (`:277-285`) can close it.
- `Widgets/Menu.js:327`: `setup_connect(connect_icon, set_color)` runs on every `init()`, and `setup_connect` ends with
  `connect(ws_param || "ws://127.0.0.1:56781", signing_param, true)` (`TelemetryDashboard.js:318`).
- `Widgets/Menu.js:384-388`: `destroy() { this.grid.destroy() this.grid = null super.destroy() }`. `Base_Class.js:200-202`:
  `destroy() { this.edit_tip.destroy() }`. Neither closes the socket.
- `TelemetryDashboard.js:401-403` (`clear_grid`): `widget.destroy()` / `target_grid.removeWidget(widget)`. This is the
  only clean-up a removed menu gets.
- `Widgets/Menu.js:268-274`: changing Rows calls `load_layout(layout.grid, layout.widgets)`, which re-creates every
  widget, the menu included.
- `TelemetryDashboard.js:146-147`: `// Make sure we are not connected to something else` / `disconnect()`. This states
  that one connection is intended.

The old menu's controls go with it, so after a reload no control on the page can close the first socket. The visible
Disconnect leaves the widgets still receiving data. The page's own control fails to do what it offers.

**Minimal correct behaviour:** removing a menu widget closes the connection it opened (and stops its heartbeat timer),
so at most the live menu's socket feeds the page.

**Smallest port change:** in `WidgetMenu.destroy` (`apps/telemetry-dashboard/src/widgets/menu.ts:144`), disconnect the
connection that this menu's `createConnectionPanel` opened before `super.destroy()`. Expose a `disconnect`/`dispose`
from the panel if it has none.

## 69. A signing passphrase stays active for later connections

**Row:** `TelemetryDashboard.js` `connect` (one `MAVLink20Processor`; only `sign_outgoing` is reset). After connecting
once with a passphrase, reconnecting without one still rejects unsigned frames.

**Verdict:** PROVEN (it contradicts itself: the empty passphrase field is labelled "Signing disabled", yet frames are
rejected for lacking a signature).

**Tests:** `#69 … after connecting with a passphrase, a connection with the field empty rejects unsigned frames`. The
test connects with `secret`, disconnects, then connects with the field empty. `sign_outgoing` is `false`, but
`secret_key.length` is still `32`, and an unsigned HEARTBEAT reaches no widget (`[]`). Control
`… the same empty-field connection on a fresh page accepts the frame`: the same connection on a fresh page gives
`['HEARTBEAT']`.

**Evidence:**

- `index.html:193`: `<input id="signing_key" type="password" placeholder="Signing disabled">`. This placeholder is what
  the field shows when it is empty.
- `TelemetryDashboard.js:163-169`: `MAVLink.signing.sign_outgoing = false` /
  `if ((passphrase != null) && (passphrase.length > 0)) { … MAVLink.signing.secret_key = new Uint8Array(hash); … }`.
  Nothing clears `secret_key`.
- `index.html:228`: `MAVLink = new MAVLink20Processor()`. One processor serves the page's whole lifetime.
- `modules/MAVLink/mavlink.js:19411` `if (this.signing.secret_key.length != 0 ){` … `:19433`
  `if (!accept_signature) throw new Error('Invalid signature');`. With the key left set, every unsigned frame is
  refused.

**Minimal correct behaviour:** a connection made with an empty passphrase neither signs nor verifies, so it accepts
unsigned frames, as on a fresh page.

**Smallest port change:** in `apps/telemetry-dashboard/src/connection/connection.ts`, when connecting without a
passphrase, clear the key (`keySet = false` and zero the `secretKey`) next to switching outgoing signing off. Today only
`setSigningKey` (`:116`) touches it.

## 70. Unrecognised file message shows `[object File]`

**Row:** `TelemetryDashboard.js` `load_file` (`"Unable to load from: " + file`).

**Verdict:** NOT PROVEN (reproduced exactly, but no allowed reference says what should follow "from:"; the same
text in Video Overlay, row 118, has the same verdict).

**Test:** `#70 … a JSON file with neither widgets nor widget is reported as "[object File]"`. The input is a `File`
named `MyLayout.json` containing `{"header":{"version":1}}`, and the alert is exactly
`Unable to load from: [object File]`.

**Evidence:**

- `TelemetryDashboard.js:581`: `const file = e.files[0]`.
- `TelemetryDashboard.js:599`: `alert("Unable to load from: " + file)`. String concatenation of a `File` gives its
  default `toString`, `[object File]`, and the test asserts this output.

The file is refused, as intended. Nothing in the page states that the file name, or any other property, was meant to be
shown, so naming one would be a preference. Cosmetic text only; stays reproduced.

## 71. Palette never initialises if one example widget fails to load

**Row:** `TelemetryDashboard.js` `init_pallet` (inner promise never rejects). A failed fetch leaves
`Promise.allSettled` pending, so the palette grid stays in batch mode and no widget is initialised.

**Verdict:** PROVEN (it contradicts itself and it fails: `reject` is declared and never called, so `allSettled` never
settles. The three built-in widgets and every example that did load are never initialised).

**Tests:** `#71 … one failed fetch: batch mode is never ended and no palette widget is initialised`. With
`SandBoxWidgets/Stats.json` rejecting `TypeError: Failed to fetch`, 9 widgets are constructed (3 built-in and 6
examples). The grid log has only `['batchUpdate', true]`, no `init` call is made, and the only rejection left unhandled
is `TypeError: Failed to fetch`. Control `… all fetches succeed and all ten widgets are initialised`: the log has
`['batchUpdate', true], ['batchUpdate', false]` and 10 `init` calls.

**Evidence:**

- `TelemetryDashboard.js:668-678`:
  `import_done.push( new Promise((resolve, reject) => { fetch(file.path).then(…).then((obj) => { … resolve() }) }) )`.
  There is no rejection path, and `reject` is unused.
- `TelemetryDashboard.js:681-688`: `// Wait for all files to load` /
  `Promise.allSettled(import_done).then(() => { palette.batchUpdate(false) // Call init on each widget after grid has updated for (const widget of palette.getGridItems()) { widget.init() } …`.
  `allSettled` is the combinator that proceeds whether an input fulfils or rejects. Here it waits on a promise that can
  only fulfil.

**Minimal correct behaviour:** a failed example settles its entry, so the palette leaves batch mode and initialises
(and adds tips to) every widget that was added. The failed example is simply missing.

**Smallest port change:** in `apps/telemetry-dashboard/src/dashboard/palette.ts:68-80`, settle each import when it
fails, by passing the `fetch` chain itself to `allSettled` or by adding `reject` to the chain's `.catch`.

## 158. Two open connections feed one MAVLink parser

**Row:** `TelemetryDashboard.js` `setup_connect` (every menu's socket calls the global `MAVLink.parseChar`). With the
old and the re-created menu both connected, bytes from the two sockets interleave in one parser, and frames split across
chunks are lost.

**Verdict:** PROVEN, as a consequence of row 68 (it fails: valid frames from valid streams are dropped as CRC errors).

**Tests:** `#158 … a frame split across two messages of one socket is lost when the other socket delivers in between`.
Socket 1 gets the first 10 bytes of HEARTBEAT A, socket 2 a whole HEARTBEAT B, then socket 1 the rest of A. Nothing is
broadcast (`0` messages), and `total_receive_errors > 0`. Control `… the same bytes in stream order on one socket give
both frames`: `['HEARTBEAT', 'HEARTBEAT']`.

**Evidence:**

- `TelemetryDashboard.js:229-238`: each socket's `ws.onmessage` feeds `MAVLink.parseChar(char)`, and `MAVLink` is the
  single page-wide processor (`index.html:228`).
- `index.html:170`: the help text describes the connection as a "WebSocket server forwarding raw binary MAVLink" and
  points to a "TCP to WebSocket" forwarder. That is a byte stream, and its message boundaries need not match frame
  boundaries.

The shared parser is correct while one socket is open. Row 68 leaves two open, and two streams then corrupt each other's
frames in progress.

**Minimal correct behaviour:** only one socket feeds the parser at a time.

**Smallest port change:** none beyond row 68's. Closing a destroyed menu's connection leaves one stream per parser.

## 159. A sandbox script that returns a primitive can no longer be edited

**Row:** `Widgets/SandBox.html` `handle_user_options` (`"handle_options" in user_class` outside the try). A script
ending `return 0` makes every options message throw, which also skips the script sent with it, so edits never load.

**Verdict:** PROVEN (it fails: the editor's change is never loaded, and the page throws instead of reporting the error
in the widget).

**Test:** `#159 every later {script, options} post throws before the edited script is read`. The script
`div.appendChild(document.createTextNode("old"))\nreturn 0` loads and shows `old`. Posting the edited script
`…"new"…` with options throws, and the widget still shows `old`. A MAVLink message then draws
`… handle_msg is not a function` and clears the class. The next edit re-runs the old script first, throws again, and
shows `old`. `new` never appears.

**Evidence:**

- `Widgets/SandBox.js:65-70` (`init`) and `:98-104` (`set_edited_text` → `this.init()`): an edit posts
  `{ script: this.script_text, options: this.get_form_content() }`, with both keys in one message.
- `Widgets/SandBox.html:169-177`: `if ("options" in data) { handle_user_options(data.options) }` runs before
  `if ("script" in data) { user_script = data.script + "\n return this"; load_user_script() }`, so a throw in the first
  skips the second.
- `Widgets/SandBox.html:120-121`: `user_class = user_fun(user_div, options)`, which is `0` for `return 0`.
- `Widgets/SandBox.html:145-153`: `if ((user_class == null) && (user_script != null)) { … load_user_script() }` then
  `if ((user_class == null) || !("handle_options" in user_class)) { // handle_options method is optional`. The `in`
  operator throws a TypeError for the primitive `0`, outside the `try` at `:156-160`.

Every other user error is caught and drawn by `user_error` so that the user can fix the script. This one blocks the fix
itself: the new script is never read.

**Minimal correct behaviour:** a non-object script result is treated as having no `handle_options`. The options message
returns quietly, and the script in the same message is loaded.

**Smallest port change:** in `apps/telemetry-dashboard/src/sandbox/runtime.ts:93`, `return` (no `handle_options`) in
place of `throw inOperatorError(...)` when the user object is not an object or function.

## 160. A sandbox script that throws null keeps running and keeps failing

**Row:** `Widgets/SandBox.html` `user_error` (`err.stack` of null throws before `user_class = null`). The error area is
drawn empty, the report throws and the script stays loaded, so every message throws again. The same happens for a
thrown Symbol (string concatenation).

**Verdict:** PROVEN (it fails: the page's error handler throws on a value its own `catch` hands it, so the error is
never shown and the script is never stopped).

**Tests:** `#160 … throw null: the error area is drawn empty, the report throws and the script stays loaded`. With
`handle_msg = function () { throw null }`, a message throws. The area holds a single empty text node, and the border is
still `#c8c8c8`. The next message throws again. `… throw Symbol: the report throws at the string concatenation`: both
messages throw. Control `… a thrown Error is drawn in a red-bordered area and the script is stopped`: `Error: x` is
drawn, the border is `red`, and the next message does not throw.

**Evidence:**

- `Widgets/SandBox.html:135-139`: `try { user_class.handle_msg(msg) } catch (e) { user_error(e) }`. Any thrown value
  reaches `user_error`.
- `Widgets/SandBox.html:37-45`: `const user_div = replace_div()` … `const matches = regex.exec(err.stack)`. For `null`
  this throws a TypeError after the area was replaced.
- `Widgets/SandBox.html:59`: `error_txt.nodeValue = extra + err`. For a Symbol this throws a TypeError.
- `Widgets/SandBox.html:100-104`: `// Make border red` … `// Clear class` / `user_class = null`. These are never reached.

**Minimal correct behaviour:** `user_error` completes for any thrown value. It draws a text for it (e.g. `null`,
`Symbol(s)`), turns the border red and clears the class, as it does for an `Error`.

**Smallest port change:** in `apps/telemetry-dashboard/src/sandbox/page.ts` `showError` (`:70-72`), read a stack only
from an object (`null`/`undefined` → no location) and build the text with `String(error)` in place of the concatenation
helper.

## 161. The settings popup is updated only while it is shown

**Row:** `TelemetryDashboard.js` `init_grid` (`getElementById("settings_tip_div")`). Loading a layout updates the
Columns/Rows inputs only if a settings popup is open (and then the old menu's orphaned popup).

**Verdict:** NOT PROVEN (behaviour reproduced; no visible input is left wrong). The row is partly mis-described: after a
layout load, the inputs the user can reach belong to the re-created menu, and that menu sets them itself.

**Test:** `#161 init_grid writes nothing when the popup is not in the document; a new menu copies the grid size itself`.
`init_grid(3, 4)` with the popup absent touches no `num_columns`/`num_rows` input. A menu initialised afterwards shows
`[3, 4]`.

**Evidence:**

- `TelemetryDashboard.js:429-437`: `// Set the input values to match the current grid` /
  `const grid_settings = document.getElementById("settings_tip_div") if (grid_settings != null) { … }`.
- `Widgets/Menu.js:261-262` `num_columns.value = grid.opts.column` and `:268-269` `num_rows.value = grid.opts.maxRow`,
  which run in every menu's `init()` after the grid is rebuilt.

Every path that rebuilds the grid (`load_layout`) also re-creates the menu, and that menu copies the new grid size into
its own popup. The lookup in `init_grid` only affects a popup that is already orphaned. No reference shows a wrong
value reaching the user.

## 162. Text WebSocket frames are fed to the parser as zero bytes

**Row:** `TelemetryDashboard.js` `ws.onmessage` (`new Uint8Array(msg.data)`). A text frame "5" feeds five zero bytes
(inside a partial frame they corrupt it), and "-1" throws.

**Verdict:** NOT PROVEN (behaviour reproduced; text frames are outside the input the tool defines).

**Test:** `#162 … a text frame "5" inside a partial frame corrupts it; "-1" throws`. `new Uint8Array("5")` is
`[0, 0, 0, 0, 0]`, a HEARTBEAT split around that text frame is lost, and `"-1"` throws
`Invalid typed array length: -1`.

**Evidence:**

- `index.html:170`: `Connection address for WebSocket server forwarding raw binary MAVLink.`
- `TelemetryDashboard.js:172`: `ws.binaryType = "arraybuffer"`. `:231`: `for (const char of new Uint8Array(msg.data))`.

The page states that the server sends binary MAVLink. Nothing in the tool, ArduPilot or MAVLink defines what a text
frame on this link should do. The throw only discards a frame that is not MAVLink, and the next frame is handled
normally. No reference fixes a correct output.

## 163. A widget that won't fit is reported before its type is checked

**Row:** `TelemetryDashboard.js` `add_widget` (fit check before `new_widget`). A layout entry with an unknown type that
does not fit shows "Widget won't fit on Grid" and the layout loads. One that fits fails the whole layout. The same
happens in Video Overlay.

**Verdict:** NOT PROVEN (behaviour reproduced; both inputs are invalid and both are reported).

**Test:** `#163 … unknown type that does not fit: alert, no error; unknown type that fits: throws`. `{type: 'Nope', x: 5}`
on a 2-column grid returns `undefined` with the alert `Widget won't fit on Grid`, and `{type: 'Nope', x: 0}` throws
`Unknown widget type: Nope`.

**Evidence:** `TelemetryDashboard.js:515-524` (the `willItFit` checks with `alert("Widget won't fit on Grid")` /
`return`, then `new_widget(obj.type, obj.options)`), and `:475` `throw new Error("Unknown widget type: " + type)`.

Nothing states which error takes precedence, or that a widget which does not fit must fail the layout. Each order
reports a real problem with the entry.

## 164. A failed layout leaves earlier widgets created and the grid in batch mode

**Row:** `TelemetryDashboard.js` `load_widgets` / `load_layout`. Widgets before the failing entry are constructed (not
initialised), and the half-loaded grid stays until the fetched default layout replaces it. A sub grid whose stored
widgets fail does so when it is initialised, after every top-level widget exists. The same happens in Video Overlay.

**Verdict:** NOT PROVEN (behaviour reproduced; the stated fallback happens, and the interim state is not specified).

**Test:** `#164 … the widget before the failing entry is constructed, never initialised, and batch mode is not ended`.
The layout `{0: WidgetSandBox, 1: 'Nope'}` logs
`batchUpdate(true), new WidgetSandBox, addWidget, set_edit(false), set_edit(false)`, with no `batchUpdate(false)` and no
`init`. The alert is `Grid load failed\nUnknown widget type: Nope`, and `Default_Layout.json` is fetched. The sub-grid
part follows from the same code (`load_widgets` called from a sub grid's `init`) and is not reproduced separately; it
has no stated intent either.

**Evidence:** `TelemetryDashboard.js:536-547` (`batchUpdate(true)`, the `add_widget` loop, then `batchUpdate(false)`
and `init`, which are skipped by a throw) and `:565-569`
`catch (error) { load_default_grid() alert('Grid load failed\n' + error.message) }`.

The catch states what should happen on failure: show the default layout. That happens once the fetch completes. What
the grid holds in between is not stated anywhere, so no reference makes the interim state wrong.
