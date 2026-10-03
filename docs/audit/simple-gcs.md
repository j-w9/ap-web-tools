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
and parsers on both sides with a fake clock. Oracle tests run upstream `mavparam.js` and
`mavftp.js` `MissionParser` side by side (`params/packed.test.ts`, `mission/mission-file.test.ts`).

One case is narrowed: "wire header uses all 16 sequence bits, binary input variants" also feeds
strings and plain arrays to `parseOp`. Those inputs only exist because upstream's untyped MAVLink
library can deliver them; the typed parser always receives `Uint8Array`, so the port checks
`Uint8Array` and a subarray with a byte offset.

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
constructor, lock rejection, lock exhaustion) with invalid URLs not saved, and Disconnect cancelling
a pending reservation. The video checks without a server (cancelled settings, protected streams
never using native HLS, error texts) are in `video/video-config.test.ts`.

Still manual (DOM/pixel level, checked once in Chrome against the dev server, no vehicle): map
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
| Socket constructor errors: toast "Cannot open connection: …", no retry                                                                                                          | `GcsSession.connect`                                                                      | identical                                                                                                                                                         |
| Signing: SHA-256 of the passphrase, timestamp raised to now at each connect, replay watermarks per endpoint+key for the page lifetime; empty passphrase disables signing        | `GcsSession.signingFor` (one `MavlinkSigning` per context, page timestamp carried across) | identical                                                                                                                                                         |
| 1 Hz GCS heartbeat (6, 8, 0, 0, 4, version 3), packed before the open check; stops with "Heartbeat stopped after error"                                                         | `startHeartbeatLoop`                                                                      | identical                                                                                                                                                         |
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
| COMMAND_INT in GLOBAL_RELATIVE_ALT_INT, params `                                                                                                                                                |                                                    | 0`, x/y as jspack int32                            | `session.sendCommand`, `commands.ts` | identical |
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

| Upstream item                                                                                                                                                                                                                        | Port location            | Status                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Packed decode/encode, `valueForType`, text parse/save, `formatValue`, `vehicleName`                                                                                                                                                  | `params/packed.ts`       | identical (oracle)                                                                                                        |
| `MAVParam` transactions, verified apply, reset, search, disconnect invalidation                                                                                                                                                      | `params/model.ts`        | identical                                                                                                                 |
| `MAVParamDefinitions` (URL per vehicle, Cache Storage, weekly refresh, offline copy)                                                                                                                                                 | `params/definitions.ts`  | identical                                                                                                                 |
| Editor: fetch on open, descriptions status, search, non-default filter, 50 per page, apply, enum select, bitmask (int32 bit 31), reset, read-only, save all/non-default, load with preview and read-only skip, 4 MiB limit, messages | `ui/ParameterEditor.tsx` | identical texts and behaviour; themed modal (presentation); bitmask checkboxes follow the typed value live (presentation) |
| Messages before any vehicle: "Connect to a vehicle…", after any disconnect (including the one each connect starts with) "Disconnected. Reconnect…"                                                                                   | `snapshot.paramEpoch`    | identical                                                                                                                 |

## Map (`map.js`, `grid.js`, `userloc.js`, `util.js`)

| Upstream item                                                                                                                        | Port location                                                                      | Status       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------ |
| Leaflet 1.9.4 map at [0,0] z2, metric scale bar, context menu suppressed                                                             | `ui/GcsMap.tsx` (npm `leaflet@1.9.4`)                                              | identical    |
| Tile providers and labels; Google types via GoogleMutant after loading the Maps API, OSM on failure; Google options only with a key  | `map/tiles.ts`, `map/google-maps.ts` (npm `leaflet.gridlayer.googlemutant@0.16.0`) | identical    |
| Vehicle SVG icons by class, rotated by heading, faded when stale; target marker; first-fix centring at z16; Recenter at max(zoom,16) | `map/vehicle-icon.ts`, `GcsMap`                                                    | identical    |
| Long press 600 ms, 10 px tolerance, second pointer cancels until all lift, exclusions, blur                                          | `map/long-press.ts`                                                                | identical    |
| Metric grid (powers of ten, latitude-corrected, DPR-independent)                                                                     | `map/grid.ts`, `map/metric-grid-layer.ts`                                          | identical    |
| My location watch, 15 s retries, stop on denial or 50 errors, toasts; no auto-centre                                                 | `map/user-location.ts`                                                             | identical    |
| Dark theme                                                                                                                           | light tile sets inverted in the tile pane, as Geofence Generator                   | presentation |

## Video (`video.js`, `webrtc-player.js`, `video-window.js`, `vendor/mediamtx/reader.js`)

| Upstream item                                                                                                                                                                  | Port location                                                       | Status                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| MediaMTX WHEP reader v1.21.0 (no npm package)                                                                                                                                  | `video/mediamtx/reader.ts`                                          | identical logic; typed TypeScript port of the vendored file (MIT, `LICENSE` kept) so it passes the repo's type, lint and format checks        |
| `WebRTCPlayer` statuses, error texts, cleanup on close/pagehide                                                                                                                | `video/webrtc-player.ts`                                            | identical                                                                                                                                     |
| Inset panel: WebRTC first, HLS toggle, HLS rules (https page + http URL, auth → Hls.js, native without auth, else WebRTC), Hls.js settings, 3 fatal errors → WebRTC, 2 s retry | `ui/VideoSurface.tsx`, `video/video-config.ts` (npm `hls.js@1.7.3`) | identical                                                                                                                                     |
| Hide stops playback and keeps position; close removes; drag/resize with clamps; phone sizing and re-anchoring                                                                  | `ui/VideoPanel.tsx`                                                 | identical                                                                                                                                     |
| Settings via four `prompt()`s; any cancel or blank host/path keeps the saved values                                                                                            | in-panel form with the four fields, Save/Cancel                     | browser-forced (prompt → in-page form)                                                                                                        |
| New window: `video.html` receives options by `postMessage`, 30 s timeout, credentials never in the URL                                                                         | `video/popup.ts`, `ui/VideoWindow.tsx` at `index.html#video`        | browser-forced: the build discovers one HTML entry per app, so the window is a hash route of the same page (no credentials in the URL either) |

## Configuration and helpers

| Upstream item                                                                                                                             | Port location                                                                               | Status                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `config.js` setting `window.SIMPLEGCS_CONFIG` (`title`, `defaultUrl`, `defaultSystemId`, `defaultComponentId`) and `window.GMAPS_API_KEY` | optional `config.json` beside the page (`config.example.json`, ignored by Git), `config.ts` | browser-forced: a bundled app cannot rely on a classic global script; same fields, the key as `googleMapsApiKey` |
| Google key from Settings (`gcs.gmaps.apikey`), "API key saved. Refresh page to apply."                                                    | `SettingsPanel`, `AppSettingsStore.setGoogleKey`                                            | identical                                                                                                        |
| Settings opening moves a Google provider to OSM without a key                                                                             | applied at load, because Settings are always visible                                        | presentation                                                                                                     |
| `node_ftp.js`, `cli_test.js` (Node, `ws` package)                                                                                         | `src/cli/simple-gcs-cli.ts` `fetch` / `dump` (Node's built-in WebSocket)                    | identical behaviour; one CLI with two commands (presentation)                                                    |
| Toolbar and tippy popovers (menu, Settings, connection)                                                                                   | ToolPage rail (connection, telemetry, vehicle commands, settings) and map section tools     | presentation                                                                                                     |
| Toasts                                                                                                                                    | bottom-centre toast stack with the same texts and durations                                 | presentation                                                                                                     |

## Upstream bugs reproduced

See [`upstream-bugs.md`](../upstream-bugs.md): result 6 reported as "RESULT 6" (`MAV_RESULT_CANCELLED`
missing from the dialect) and video settings saved untrimmed after a trimmed blank check.
