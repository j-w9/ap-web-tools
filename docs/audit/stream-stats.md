# Stream Stats audit

Upstream: `upstream/StreamStats/` (`StreamStats.js`, `mavlink_msgs.js`, `index.html`), with
`Libraries/Array_Math.js`, `Libraries/OpenIn.js` and `modules/JsDataflashParser/parser.js`.
Port: `apps/stream-stats/`.

Oracle tests run the upstream JavaScript in `node:vm` (`src/analysis/test-support/upstream.ts`) and,
for `.bin` logs, the real upstream `JsDataflashParser` on the fixture logs
(`src/analysis/stats.test.ts`).

## Inventory

| Upstream item                                                                                                              | Port location                                            | Status                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin_time` (range, scale, offset)                                                                                          | `analysis/rates.ts` `binCentres`                         | identical (oracle)                                                                                                                                                                                 |
| `bin_count` incl. sparse `total.count`, `1 / bin_width` scaling                                                            | `analysis/rates.ts` `binCount`                           | reverted in this audit: was a bin-sum rewrite that rejected negative/zero widths; now step for step, negative bins and `RangeError` included (oracle for widths 0.1 to Infinity, negative, 0, NaN) |
| `total_count` (`slice(low, high + 1)`, divide by width)                                                                    | `analysis/rates.ts` `totalCount`                         | reverted in this audit (as above)                                                                                                                                                                  |
| `load_tlog` framing: magic, header lengths, truncation `break`, CRC-16/MCRF4XX with CRC_EXTRA, skip one byte on bad id/CRC | `analysis/mavlink/frame.ts`, `analysis/tlog.ts`          | identical (oracle)                                                                                                                                                                                 |
| `mavlink_msgs`, `MAV_COMPONENT` tables                                                                                     | `analysis/mavlink/messages.ts`                           | identical (checked entry for entry)                                                                                                                                                                |
| Per system/component/message stats: received, dropped (wrap at 256), versions, signing, times, sizes in bits               | `analysis/tlog.ts` `parseTlog`                           | identical (oracle)                                                                                                                                                                                 |
| "Time went backwards!" alert, then throw                                                                                   | `TlogTimeError` message, shown in the error banner       | reverted in this audit: message text was rewritten; now upstream's text (crash clause: no result)                                                                                                  |
| `plot_tlog`: include checkboxes (component disables its messages), rates, total, composition `(sys, comp) name`            | `analysis/stats.ts` `tlogStats`, `ui/MavlinkSystems.tsx` | identical (oracle incl. exclusions)                                                                                                                                                                |
| `plot_log`: composition of every `stats()` entry, rates for count != 0 with `TimeUS`, instances concatenated               | `analysis/bin.ts`, `analysis/stats.ts` `binLogStats`     | reverted in this audit: zero-count types were dropped and the pie converted to bits; now every format (count 0 included) and bytes (upstream bug)                                                  |
| `log.stats() == null` alert "Failed to get stats"                                                                          | none                                                     | unreachable upstream (`stats()` always returns an object)                                                                                                                                          |
| "Total size: N Bytes" (bits mode, `.bin` only)                                                                             | `App.tsx` Composition section                            | reverted in this audit: was `toLocaleString()` and "bytes"; now upstream text                                                                                                                      |
| `rate_plot` labels and hover templates                                                                                     | `ui/traces.ts` `RATE_LABELS`                             | identical; the name is written into the template instead of `meta` (presentation)                                                                                                                  |
| Trace types: `scattergl` for `.bin` and total, default `scatter` for `.tlog` rates                                         | `ui/traces.ts`                                           | identical                                                                                                                                                                                          |
| Linked x axes and reset between total and message rates                                                                    | `App.tsx` (`linkAxisRanges`, `linkAutorangeReset`)       | identical                                                                                                                                                                                          |
| Rate unit radio (bits default), window size (default 10, `min=0.1 step=1`, `onchange`)                                     | `ui/Rail.tsx`                                            | reverted in this audit: window was read on every keystroke, invalid values ignored; now read with `parseFloat` on the native `change` event and used as is                                         |
| `load`: dispatch on `.bin` / `.tlog` extension, other files ignored after reset                                            | `analysis/load.ts` `logFormat`, `App.tsx`                | reverted in this audit: an added "not a .bin or .tlog" message was removed                                                                                                                         |
| Empty / garbage files: empty section and plots                                                                             | `analysis/load.ts` `loadLog`                             | reverted in this audit: added "No valid MAVLink messages" / "No messages found" errors removed                                                                                                     |
| Open In (enabled for `.bin`, receives files from other tools as `.bin`)                                                    | `OpenInButton`, `useLogFile` (`logFormat(null)` = bin)   | identical                                                                                                                                                                                          |
| Hidden "Time and size" plot (`#time_size`)                                                                                 | none                                                     | never plotted upstream (no code writes to it; its `div` is always hidden): nothing to port                                                                                                         |
| Start time `console.log`, load time `console.log`                                                                          | rail fact "Start"                                        | convenience (a value upstream only logs)                                                                                                                                                           |
| `window.onerror` alert                                                                                                     | `ErrorBanner`                                            | crash clause                                                                                                                                                                                       |

## Remaining intentional differences

- Presentation: rail and sections instead of tables and fieldsets; badges "Signed"/"Unsigned" for
  ✅/❌; component cards; plot margins; a placeholder before a log is loaded.
- Conveniences (no computed result changes): rail facts File, Format, Size, Start (upstream logs the
  start time to the console), Duration (time of the last frame, the x range of the plots), number of
  components and of message types; message count in each component's "Messages" summary; the page
  title shows the file name.
- Crash clause: where upstream throws (window size 0 or empty, time going backwards) the port shows
  the error message in a banner instead of plots. Upstream's alert wraps the message in its generic
  "Sorry, something went wrong" text; the stale plots it leaves on screen are not kept.
- Upstream's `linear`/`Plotly` hover uses `meta`; the port inlines the same name (types do not
  declare `meta`).

## Upstream bugs reproduced

| Location                                                                           | Reproduction                                            | Effect                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `plot_log`: `values.push(use_size ? value.size : value.count)` with a "bits" hover | Load a `.bin`, Bits per second                          | Pie values are bytes labelled bits (8x too small; shares correct) |
| `parser.js` built-in `FMT[128]` has no `Size`                                      | `.bin` without its own FMT record (e.g. 100 zero bytes) | FMT slice value NaN                                               |
| `plot_log` includes `Total_Length == 0` formats                                    | Any log with defined but unused formats                 | Zero-value slices (invisible)                                     |
| `bin_count` / `total_count` with a negative window                                 | Window size -4                                          | Negative rates; total omits negative bins, `null` if no bin 0     |
| `array_from_range` with a window of 0 or empty                                     | Window size 0 or empty                                  | `RangeError: Invalid array length`, nothing replotted             |
| `bin_count` on an empty series                                                     | not reachable (every series has at least one record)    | would throw the same `RangeError`                                 |

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in dark and light: empty, the SITL
`.bin`, and a synthetic `.tlog` (`apps/stream-stats/test-fixtures/synthetic.tlog`, 3000 frames
from two systems and three components, made with `buildTlog` from
`src/analysis/test-support/tlog-writer.ts`) with a component's message table open. Include chips,
message tables (`<details>`), the unit chips and the window input work from the keyboard. No
console errors, overflow or clipped text. Compared against `upstream/StreamStats/index.html`:
every component field, message include, unit option, plot and the bin total size are present.

Changed (presentation only):

- Component cards: the MAVLink id name moved under the card title (it broke mid-word in the facts
  list), cards are at least 340 px wide, and the message table is compact so the include column
  fits; on phones long message names wrap.
- Composition pie is 420 px tall on phones (720 px elsewhere) instead of leaving half the card
  empty.
- Plot right margin 20 px (was 50 with no right axis).
- Bin total size reads "Total size: 589,824 bytes".
- Inline styles moved to `ui/stream-stats.css`.

Remaining: many small pie slices of a busy `.bin` have unreadable labels (upstream's pie; hover
shows them).
