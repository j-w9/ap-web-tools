# Audit: Simple GCS

Port: `apps/simple-gcs`. Upstream: `upstream/SimpleGCS/` (`index.html`, `app.js`, `commands.js`,
`fence.js`, `ftp_manager.js`, `grid.js`, `map.js`, `mission.js`, `userloc.js`, `util.js`, `video.js`,
`webrtc-player.js`, `video-window.js`, `video.html`, `vendor/mediamtx/reader.js`, `config.example.js`,
`node_ftp.js`, `cli_test.js`) plus `modules/MAVLink/mavftp.js`, `mavparam.js`, `mavparam-ui.js/.css`.
MAVLink framing and signing come from `@apwt/mavlink` (port of upstream `mavlink.js`, whose test
`tests/mavlink.test.cjs` is already ported in `packages/mavlink/src/fixtures.test.ts`).

Standard: [`docs/porting-policy.md`](../porting-policy.md). Status values: **identical** (same
result, restructured code), **presentation**, **convenience**, **browser-forced**, **crash**.

## Tests

Every case of `tests/mavftp.test.cjs`, `ftp_manager.test.cjs`, `commands.test.cjs`,
`mavparam.test.cjs`, `grid.test.cjs`, `simplegcs-interactions.test.cjs` and `webrtc-player.test.cjs`
is ported to vitest next to the code (`*.test.ts`), with the pymavlink-independent fixtures read from
`upstream/tests/fixtures/`. MAVFTP tests run real MAVLink 2 frames through `@apwt/mavlink` encoders
and parsers on both sides with a fake clock.

Oracle tests run the upstream JavaScript unmodified (CommonJS or `node:vm`) beside the port on the
same inputs:

- `ftp/client.oracle.test.ts`: `mavftp.js` `MAVFTP` against a seeded lossy simulated vehicle (drops,
  duplicates, wrong ids, stale sequences, short/oversized reads, wrong size estimates, NACKs, sequence
  wrap, cancels, uploads, resets); every packet sent (with frame sequence), accept/reject result and
  outcome compared (150 seeds).
- `ftp/manager.oracle.test.ts`: `ftp_manager.js` with random queue, timeout, de-duplication and link
  operations (100 seeds).
- `mission/fetch.oracle.test.ts`: `fence.js` and `mission.js` against `FileFetcher` wired as in
  `session.ts`; toasts, transfers, cancellations and overlays (60 seeds each).
- `mission/mission-file.test.ts`, `params/packed.test.ts`: `MissionParser`, `MAVParam` statics.
- `params/editor.test.ts`: `mavparam-ui.js` over a small fake DOM, driven by upstream `MAVParam`:
  status and description messages, rows (including malformed definitions), search, bitmask toggling,
  paging and clamping, save, import preview and every import error. `params/model.test.ts` also
  compares the `cache` option.
- `commands/acks.test.ts`: `commands.js` `CommandAcks` over random submit/ACK/timeout/clear
  sequences; `commands/commands.test.ts`: every COMMAND_INT the GCS sends is byte-identical to
  upstream `mavlink.js` `command_int(...).pack()` built as `sendCommandInt` does (fractional,
  out-of-range and NaN coordinates included).
- `map/long-press.oracle.test.ts` (`map.js` gesture, 300 seeds), `map/grid.oracle.test.ts` (`grid.js`
  canvas calls at several DPRs), `map/user-location.oracle.test.ts` (`userloc.js`, 200 seeds and the
  50-error give-up), `map/google-maps.oracle.test.ts` (`util.js` `GMapsLoader`).
- `video/video.oracle.test.ts` (`webrtc-player.js` statuses, `video.js` `openNewWindow` handshake) and
  `video/mediamtx/reader.oracle.test.ts` (vendored `reader.js` against a fake RTCPeerConnection and
  WHEP server, 120 seeds: every request, description, close, error text and track).

One case is narrowed: "wire header uses all 16 sequence bits, binary input variants" also feeds
strings and plain arrays to `parseOp`. Those inputs only exist because upstream's untyped MAVLink
library can deliver them; the typed parser always receives `Uint8Array`, so the port checks
`Uint8Array` and a subarray with a byte offset. Upstream's fake FTP client in `ftp_manager.test.cjs`
throws if `resetSessions` is called; the port's client interface has no reset method at all, so that
check holds by construction. In `mavparam.test.cjs`, `bitmask[2] === 'C'` became
`toMatchObject({ 2: 'C' })` because published definitions are kept raw (`unknown`).

`tests/browser.cjs` and `tests/video-browser.cjs` (Playwright) are not run in CI. Their protocol
flows are ported to `session.test.ts` against a simulated signed vehicle (fake socket, fake Web
Locks, in-memory storage): no unsolicited connection, signed FTP with heartbeat off and vehicle
addressing, circle fence and mission download, arm/loiter/guided reposition, ACK denial and
timeout reporting, nothing sent without a vehicle, reconnect with submitted settings while the
editor keeps its draft, Connect applying new URL/ids/signing/heartbeat, late close of a replaced
socket, dead peer amid foreign relay traffic (stale at 3 s, close code 4000 and reconnect within
18.5 s, data cleared, same vehicle keeps the view, a different vehicle recentres), replayed signed
heartbeat rejected across reconnect, explicit disconnect recentring, configured default vs saved URL,
duplicated tab getting another component id, the four startup faults (fragment URL, socket
constructor, lock rejection, lock exhaustion) with invalid URLs not saved and the editor kept open,
and Disconnect cancelling a pending reservation, also when a newer Connect completes first. Added by
the audit from `app.js` directly: startup fault texts and no retry after a constructor error, the
2/4/8/16/30/30 s reconnect back-off and its reset by vehicle traffic, "Waiting for vehicle" with
"Connect (4s)" at 3.5 s and the 4000 "link stall" close only after 15 s, the heartbeat fields at 1 Hz,
COMMAND_ACK matching only our ids with IN_PROGRESS extending the deadline, BATTERY_STATUS, GPS
(255 → none), SYS_STATUS fence flag, STATUSTEXT, LTE values from any component of the vehicle's system
at 1 Hz and their reset on disconnect, and the 5 s target timeout. The simulated vehicle signs its
foreign relay traffic with the vehicle key, as upstream's fixture does, so the dead-peer case
exercises the vehicle filter rather than signature rejection. The video checks without a server (cancelled settings, protected streams
never using native HLS, error texts) are in `video/video-config.test.ts`.

Still manual (DOM/pixel level, checked once in Chrome against the dev server, no vehicle; there is no
DOM test environment, so React components have no automated test): the parameter editor walk-through
of `browser.cjs` (fetch, search, edit, reset, read-only, save, load, bitmask), cancelled confirmations
sending nothing, map
long press with mouse and touch over a popup and the zoom control, two-finger pinch on the real map,
video inset drag/resize by mouse and touch and its phone width, the parameter editor at phone width
(bitmask by touch, no horizontal overflow), file save/load dialogs, the separate video window
handshake and WHEP playback against a local MediaMTX.

## Connection, link and signing (`app.js` → `session.ts`, `link/`)

| Upstream item                                                                                                                                                                   | Port location                                                                             | Status                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection dialog values: saved URL → config `defaultUrl` → `ws://127.0.0.1:5763`; system id saved → config → 255; component id session → config → random 1–255, 190 if invalid | `link/settings.ts` `initialDraft`                                                         | identical                                                                                                                                                         |
| `readConnectionSettings` (ids outside 1–255 → 255/190, URL trimmed, passphrase verbatim) and `validateConnectionUrl`                                                            | `readConnectionSettings`, `validateConnectionUrl`                                         | identical                                                                                                                                                         |
| Web Locks component reservation with next-free search, attempt cancellation, lease release                                                                                      | `link/leases.ts` `ComponentLeases`                                                        | identical                                                                                                                                                         |
| Startup: reserve id, reconnect only to a saved URL; Connect disabled meanwhile                                                                                                  | `GcsSession.start`, `snapshot.starting`                                                   | identical                                                                                                                                                         |
| Connect: validate, reserve, open, persist URL/system id (local), component id (session), passphrase or remove it, close dialog                                                  | `GcsSession.submit`, `saveConnectionSettings`                                             | identical (same storage keys)                                                                                                                                     |
| Connect button is a plain button: no browser form validation; bad URLs reach `validateConnectionUrl` and its toast, out-of-range ids fall back to 255/190                       | `ConnectionPanel` form with `noValidate` (Enter also submits: convenience)                | identical (audit fix: the form's `type=url`/`pattern`/`min`/`max` used to block Connect with a browser bubble instead)                                            |
| Socket constructor errors: toast "Cannot open connection: …", no retry                                                                                                          | `GcsSession.connect`                                                                      | identical                                                                                                                                                         |
| Signing: SHA-256 of the passphrase, timestamp raised to now at each connect, replay watermarks per endpoint+key for the page lifetime; empty passphrase disables signing        | `GcsSession.signingFor` (one `MavlinkSigning` per context, page timestamp carried across) | identical                                                                                                                                                         |
| 1 Hz GCS heartbeat (6, 8, 0, 0, 4, version 3), packed before the open check; stops with "Heartbeat stopped after error"                                                         | `startHeartbeatLoop`                                                                      | identical                                                                                                                                                         |
| `MAVLink.seq` counted only after `ws.send` returns (heartbeat, commands, MAVFTP)                                                                                                | `sendCounted`, `startHeartbeatLoop`                                                       | identical (audit fix: a throwing send used to consume a sequence number)                                                                                          |
| Link monitor every 500 ms: >3 s "Waiting for vehicle"/"Telemetry stale" and "Connect (Ns)"; >15 s detach, close 4000 "link stall", reconnect                                    | `startLinkHealthMonitor`                                                                  | identical                                                                                                                                                         |
| Reconnect back-off 2→30 s, reset by vehicle traffic; intentional disconnect stops it                                                                                            | `scheduleReconnect`, `disconnect`                                                         | identical                                                                                                                                                         |
| Handlers detached before close; late events from old sockets ignored                                                                                                            | `link/socket.ts` `detach`, socket identity checks                                         | identical                                                                                                                                                         |
| Discovery: first ArduPilot heartbeat selects the vehicle; only its packets refresh link health                                                                                  | `processMessage`, `discover`                                                              | identical, except that liveness only counts frames that decode (CRC and signature checked) and every dialect message decodes, so no difference arises in practice |
| Map identity `url:sys:comp`; same identity keeps pan/zoom, new one recentres; explicit disconnect resets                                                                        | `mapVehicleIdentity`, `snapshot.centerRequest`                                            | identical                                                                                                                                                         |
| Disconnect clears ACKs, telemetry, marker, target, fence, mission, FTP queue, parameter client                                                                                  | `disconnect`, `resetVehicleData`                                                          | identical                                                                                                                                                         |

## Telemetry and messages

| Upstream item                                                                                                                                                                                                       | Port location                              | Status                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| HEARTBEAT armed flag, Rover mode names for rover/boat, number otherwise                                                                                                                                             | `processMessage`, `vehicle/vehicle.ts`     | identical                                               |
| GLOBAL_POSITION_INT position and ground speed; ATTITUDE heading; BATTERY_STATUS %/A; GPS_RAW_INT/GPS2_RAW sats (255 → none); SYS_STATUS geofence flag; POSITION_TARGET_GLOBAL_INT target (zero clears; 5 s timeout) | `processMessage`, `updateTargetTimeout`    | identical                                               |
| Display: battery colour bands (<20, <40), current, knots, armed pill, GPS sats (≥20 green, optional)                                                                                                                | `ui/telemetry-format.ts`, `TelemetryPanel` | identical text and bands; colours themed (presentation) |
| LTE carrier (MCC/MNC table) and RSRP from NAMED_VALUE_FLOAT of the vehicle's system, refreshed at 1 Hz                                                                                                              | `updateLte`, `MCCMNC_MAP`                  | identical                                               |
| COMMAND_ACK matched only when addressed to our ids; non-ACCEPTED results to Messages (ERR) and a 3 s toast                                                                                                          | `processMessage`, `reportAck`              | identical                                               |
| STATUSTEXT log, 500 entries, `HH:MM:SS  [TAG] text`                                                                                                                                                                 | `vehicle/status-log.ts`, `MessagesLog`     | identical                                               |
| Messages popover                                                                                                                                                                                                    | Messages section under the map             | presentation                                            |

## Commands (`commands.js`, `app.js`)

| Upstream item                                                                                                                                                                                   | Port location                                      | Status                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `CommandAcks`: immediate send, per-command FIFO, 5 s timeout, in-progress extends, "not sent", clear on disconnect                                                                              | `commands/acks.ts`                                 | identical (outcomes typed; same report texts)      |
| COMMAND_INT in GLOBAL_RELATIVE_ALT_INT, missing or falsy params as 0, x/y as jspack int32                                                                                                       | `session.sendCommand`, `commands.ts`               | identical (frame oracle)                           |
| ARM, DISARM, RTL/Loiter (Rover only, "Mode controls require a connected boat or rover"), Fence Enable/Disable, Reboot, ForceArm, ForceDisarm (21196), long-press DO_REPOSITION with CHANGE_MODE | `commands.ts`, `App.tsx`                           | identical                                          |
| "Waiting for vehicle connection" without a vehicle; "X sent" only after sending                                                                                                                 | `vehicleReady`, `sendCommand`                      | identical                                          |
| `confirm()` for Reboot/ForceArm/ForceDisarm                                                                                                                                                     | in-page confirmation with the same text, OK/Cancel | browser-forced (policy: confirm → in-page message) |

## MAVFTP, fence and mission (`mavftp.js`, `ftp_manager.js`, `fence.js`, `mission.js`)

| Upstream item                                                                                                                                               | Port location                      | Status                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `MAVFTP` (burst/gap reads, retries, sequence arithmetic, virtual-file estimates, acknowledged uploads and closes, reset, session correlation, 64 MiB limit) | `ftp/protocol.ts`, `ftp/client.ts` | identical (state as a union; `null` results became `FtpOutcome`)   |
| `FTPManager` queue, watchdogs, de-duplication, link changes, no automatic reset                                                                             | `ftp/manager.ts`                   | identical                                                          |
| `MissionParser.parseMissionItems/parseFence/parseMission`                                                                                                   | `mission/mission-file.ts`          | identical (oracle)                                                 |
| Fence/mission fetch: generation, pending guard, 5 s retries while auto-fetch is on, toasts                                                                  | `mission/file-fetcher.ts`          | identical                                                          |
| Mission location commands (incl. 36) and global frames filter, sequence labels; toasts even for automatic fetches                                           | `missionPoints`, `presentMission`  | identical                                                          |
| Fence styles (green inclusion, red exclusion, dashed thin when disabled), circle-inclusion popup                                                            | `ui/GcsMap.tsx`                    | identical; layers are recreated instead of restyled (presentation) |
| Auto-fetch fence on (default) / mission off (default)                                                                                                       | `app-settings.ts`                  | identical (same keys)                                              |

## Parameters (`mavparam.js`, `mavparam-ui.js`)

| Upstream item                                                                                                                                                                                                                                                                                                                    | Port location                                                               | Status                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packed decode/encode, `valueForType`, text parse/save, `formatValue`, `vehicleName`                                                                                                                                                                                                                                              | `params/packed.ts`                                                          | identical (oracle)                                                                                                                                                                                                                                                                                                      |
| `MAVParam` transactions, verified apply, reset, search, disconnect invalidation                                                                                                                                                                                                                                                  | `params/model.ts`                                                           | identical                                                                                                                                                                                                                                                                                                               |
| `MAVParamDefinitions` (URL per vehicle, Cache Storage `mavparam-definitions-v1`, weekly refresh, 15 s timeout, offline copy; `cache: undefined` falls back to `caches`)                                                                                                                                                          | `params/definitions.ts`                                                     | identical; published values (`DisplayName`, `Description`, `Units`, `Values`, `Bitmask`) kept raw and rendered with upstream's `${}`/truthiness rules (audit fix: they used to be normalised to strings and records at parse time, which changed arrays, string `Values`/`Bitmask` and truthiness of malformed entries) |
| Editor: fetch on open, descriptions status, search, non-default filter, 50 per page (clamped page stored), apply, enum select, bitmask (int32 bit 31), reset, read-only, save all/non-default, load with preview and read-only skip, 4 MiB limit, messages                                                                       | `params/editor.ts` (pure), `ui/ParameterEditor.tsx`                         | identical texts and decisions (oracle); themed modal (presentation); bitmask checkboxes follow the typed value live, the enum select keeps the user's pick until its row remounts, the download Blob type is `text/plain;charset=utf-8` (presentation)                                                                  |
| `setClient`: keeps search, non-default filter, save scope and descriptions status; clears drafts, import preview and page; "Connect to a vehicle…" before any vehicle, "Disconnected. Reconnect…" after any disconnect (including the one each connect starts with); results and descriptions from a replaced client are dropped | `ParameterEditor` (client/`everDisconnected` change), `snapshot.paramEpoch` | identical (audit fix: the editor used to be remounted per client, losing search/filter/scope, and late results from an old client could still be shown)                                                                                                                                                                 |

## Map (`map.js`, `grid.js`, `userloc.js`, `util.js`)

| Upstream item                                                                                                                                                                                                  | Port location                                                                      | Status                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leaflet 1.9.4 map at [0,0] z2, metric scale bar, context menu suppressed                                                                                                                                       | `ui/GcsMap.tsx` (npm `leaflet@1.9.4`)                                              | identical                                                                                                                                                                                                                                   |
| Tile providers and labels; Google types via GoogleMutant after loading the Maps API, OSM on failure; Google options only with a key; the key is read only when a provider is applied ("Refresh page to apply") | `map/tiles.ts`, `map/google-maps.ts` (npm `leaflet.gridlayer.googlemutant@0.16.0`) | identical (audit fix: a key change used to re-apply the tiles at once). Switching away from Google before the Maps API loads: upstream can leave two stacked base layers; the port cancels the stale load (presentation, no computed value) |
| Vehicle SVG icons by class, rotated by heading, faded when stale; one target marker moved with `setLatLng` (popup stays open); first-fix centring at z16; Recenter at max(zoom,16)                             | `map/vehicle-icon.ts`, `GcsMap`                                                    | identical (audit fix: the target marker used to be recreated on every update, closing its popup)                                                                                                                                            |
| Long press 600 ms, 10 px tolerance, second pointer cancels until all lift, exclusions, blur                                                                                                                    | `map/long-press.ts`                                                                | identical                                                                                                                                                                                                                                   |
| Metric grid (powers of ten, latitude-corrected, DPR-independent)                                                                                                                                               | `map/grid.ts`, `map/metric-grid-layer.ts`                                          | identical                                                                                                                                                                                                                                   |
| My location watch, 15 s retries, stop on denial or 50 errors, toasts; no auto-centre                                                                                                                           | `map/user-location.ts`                                                             | identical                                                                                                                                                                                                                                   |
| Dark theme                                                                                                                                                                                                     | light tile sets inverted in the tile pane, as Geofence Generator                   | presentation                                                                                                                                                                                                                                |

## Video (`video.js`, `webrtc-player.js`, `video-window.js`, `vendor/mediamtx/reader.js`)

| Upstream item                                                                                                                                                                                                          | Port location                                                       | Status                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MediaMTX WHEP reader v1.21.0 (no npm package)                                                                                                                                                                          | `video/mediamtx/reader.ts`                                          | identical logic (oracle); typed TypeScript port of the vendored file (MIT, `LICENSE` kept). Audit fix: HTTP 400 without an `error` field reports "Error", not "Error: undefined"                                                                                            |
| `WebRTCPlayer` statuses, error texts, cleanup on close/pagehide                                                                                                                                                        | `video/webrtc-player.ts`                                            | identical                                                                                                                                                                                                                                                                   |
| Inset panel: WebRTC first, HLS toggle, HLS rules (https page + http URL, auth → Hls.js, native without auth, else WebRTC), Hls.js settings, 3 fatal errors → WebRTC, 2 s retry                                         | `ui/VideoSurface.tsx`, `video/video-config.ts` (npm `hls.js@1.7.3`) | identical                                                                                                                                                                                                                                                                   |
| Hide stops playback and keeps position; close removes; drag with clamps; resize changes only the size (a bottom-right anchored inset grows up and left); phone sizing (`clientWidth \|\| innerWidth`) and re-anchoring | `ui/VideoPanel.tsx`                                                 | identical (audit fixes: resize used to switch to left/top anchoring; a 0-width map gave a -24 px phone width)                                                                                                                                                               |
| Settings via four `prompt()`s; any cancel or blank host/path keeps the saved values                                                                                                                                    | in-panel form with the four fields, Save/Cancel                     | browser-forced (prompt → in-page form)                                                                                                                                                                                                                                      |
| New window: `video.html` receives options by `postMessage`, 30 s timeout, credentials never in the URL                                                                                                                 | `video/popup.ts`, `ui/VideoWindow.tsx` at `index.html#video`        | browser-forced: the build discovers one HTML entry per app, so the window is a hash route of the same page (no credentials in the URL either). A config message with the right `type` but malformed `options` is ignored (type-safe boundary; only our own opener sends it) |

## Configuration and helpers

| Upstream item                                                                                                                                               | Port location                                                                               | Status                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.js` setting `window.SIMPLEGCS_CONFIG` (`title`, `defaultUrl`, `defaultSystemId`, `defaultComponentId`) and `window.GMAPS_API_KEY`                   | optional `config.json` beside the page (`config.example.json`, ignored by Git), `config.ts` | browser-forced: a bundled app cannot rely on a classic global script; same fields, the key as `googleMapsApiKey`                                                                                                                                                                                                                                                                                             |
| Google key from Settings (`gcs.gmaps.apikey`) saved on the input's `change` (blur or Enter after an edit), trimmed, "API key saved. Refresh page to apply." | `SettingsPanel`, `AppSettingsStore.setGoogleKey`                                            | identical (audit fix: it used to save and toast on every blur where the text differed from the trimmed key). Clearing the key hides Google options at once but moves a selected Google provider to OSM only at the next load (upstream: when Settings reopens)                                                                                                                                               |
| Settings opening moves a Google provider to OSM without a key                                                                                               | applied at load, because Settings are always visible                                        | presentation                                                                                                                                                                                                                                                                                                                                                                                                 |
| `node_ftp.js`, `cli_test.js` (Node, `ws` package)                                                                                                           | `src/cli/simple-gcs-cli.ts` `fetch` / `dump` (Node's built-in WebSocket)                    | identical output: snake_case field names in definition order, "MAVLink message ID: -1" / "<invalid MAVLink message>" for undecodable data, the error event's message (audit fixes). Upstream parses byte by byte, so noise is reported per byte (matched); for frames with a bad CRC, unknown id or rejected signature the number of BAD_DATA lines is approximate. One CLI with two commands (presentation) |
| Toolbar and tippy popovers (menu, Settings, connection)                                                                                                     | ToolPage rail (connection, telemetry, vehicle commands, settings) and map section tools     | presentation                                                                                                                                                                                                                                                                                                                                                                                                 |
| Toasts                                                                                                                                                      | bottom-centre toast stack with the same texts and durations                                 | presentation                                                                                                                                                                                                                                                                                                                                                                                                 |

## Codec dependencies (`@apwt/mavlink`, audited separately)

The session relies on the codec for: `MavlinkEncoder.encode` advancing the frame sequence once per
frame and the signing timestamp once per signed frame (upstream `pack`); the parser accepting signed
frames only with a valid signature and fresh per-stream timestamp, raising the shared signing
timestamp from incoming frames (upstream `check_signature`), and accepting signed frames unchecked
when no key is set (upstream with an empty `secret_key`); frames that fail CRC/signature or have an
unknown id being dropped (upstream `bad_data`, `_id == -1`, skipped by `handleMessage`); missing
MAVLink 2 extension fields (e.g. COMMAND_ACK target ids) decoding as 0; FILE_TRANSFER_PROTOCOL
payloads as `Uint8Array`; and COMMAND_INT float/int32 packing (covered by the frame oracle).

## Upstream bugs reproduced

See [`upstream-bugs.md`](../upstream-bugs.md): result 6 reported as "RESULT 6" (`MAV_RESULT_CANCELLED`
missing from the dialect), video settings saved untrimmed after a trimmed blank check, a rejected
Google Maps load cached for the page's lifetime (`GMapsLoader`), and the vendored MediaMTX reader's
unobserved WHEP DELETE.

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in both themes, in six states: empty
(disconnected), the connection form, connected, the video inset, the parameter editor and a
confirmation. The connected states use a scripted rover (`src/test-utils/ui-peer.ts`) behind a
stubbed `WebSocket`: heartbeat, position, attitude, battery, GPS, LTE and status text every 500 ms,
command ACKs, and a fence, a mission and upstream's parameter fixture over MAVFTP. No real vehicle or
relay is involved. Every capture was read; keyboard use of the connection form, commands, the
confirmation and the parameter editor was checked in Chromium.

Changed (presentation only; no command, message, text of a toast or confirmation, or setting
changed):

- Rail: Connection, Telemetry, Vehicle (commands) and Parameters. Map tiles, the Google key, display
  options and auto-fetch moved to a Settings section below Messages, laid out as a grid, so on
  desktop the rail fits beside the map and on phones the map comes before the settings.
- Sentence-case labels: Arm, Disarm, Disable fence, Enable fence, Force arm, Force disarm, Fetch
  fence, Fetch mission, Video inset, Video in new window, Edit parameters, Show grid, Show my
  location, Show GPS satellite count, Send 1 Hz heartbeat, System ID, Component ID. The Messages help is plain English ("Status text from the
  vehicle…").
- The map-tile select and Google key input fill their group (were cut to 110 px: "OpenStree").
- Connection form: label above each field; URL and passphrase inputs styled like the shell's
  inputs (the shell styles only number and text inputs); the passphrase toggle sits outside the
  label, so the field's accessible name is "Signing passphrase" (was "Signing passphrase Show…").
- Parameter rows: the value label sits above its input; the input overlapped Apply at desktop width.
- The confirmation is a modal `<dialog>`: focus is trapped, Cancel has focus first, Escape cancels
  (upstream `confirm()`'s keyboard behaviour). Same text and OK/Cancel choices.
- Phone: the video inset's title bar buttons and status badge are smaller so the bar does not wrap
  over the video.
- The decorative Messages icon was removed (it wrapped onto its own line on phones).

Remaining known issues:

- The video inset logs `ERR_CONNECTION_REFUSED` in the harness: there is no MediaMTX server, and the
  inset shows its "Unable to play video" state as upstream does.
- The vehicle marker is upstream's small icon; on the light map it is easy to lose among mission
  labels.
- Map long-press and inset drag are pointer only, as upstream.
