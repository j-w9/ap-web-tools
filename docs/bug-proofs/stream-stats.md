# Stream Stats bug proofs

Rows for `Stream Stats` in [`../upstream-bugs.md`](../upstream-bugs.md). Original code:
`upstream/StreamStats/StreamStats.js` (with `Libraries/Array_Math.js`, `StreamStats/mavlink_msgs.js`)
and `upstream/modules/JsDataflashParser/parser.js`. Tests: `proofs/stream-stats/`; the `.bin` path runs
`plot_log()` on a log parsed by the original parser.

| #   | Bug                                                    | Verdict | Reproduction                                                                 |
| --- | ------------------------------------------------------ | ------- | ---------------------------------------------------------------------------- |
| 1   | DataFlash composition pie plots bytes labelled as bits | PROVEN  | `composition.test.ts` › "plots byte counts in a pie whose hover says bits …" |
| 2   | Parser's built-in FMT definition has no Size           | PROVEN  | `composition.test.ts` › "gives FMT a NaN msg_size and a NaN pie value"       |
| 3   | Window size not validated                              | PROVEN  | `window.test.ts` (all cases)                                                 |

## 1. DataFlash composition pie plots bytes labelled as bits

**Row:** `StreamStats/StreamStats.js` `plot_log` (`value.size`, `pie_hovertemplate` bits). "In bits mode
each slice's value is the type's size in bytes while the hover says bits (shares are unaffected,
absolute values are 8x too small)."

**Verdict:** PROVEN (contradicts itself).

**Reproduction:** `proofs/stream-stats/composition.test.ts` › "plots byte counts in a pie whose hover
says bits, next to a byte total and a bit rate". Log: FMT records for FMT and IMU, then ten `IMU`
records (16 bytes each with header) at 0, 1, …, 9 s. Settings: window 10, Bits per second. Output:

- pie labels `['IMU', 'FMT']`, values `[160, 178]`, hover
  `'%{label}<br>%{value:,i} bits<br>%{percent}<extra></extra>'`;
- `LOGSTATS` text `'Total size: 338 Bytes'` (the same 160 + 178);
- IMU rate `[128]` on the axis `'bits per second'`: 128 bps over the 10 s window is 1280 bits, the pie
  says 160 bits.

**Evidence:**

- `StreamStats.js:135` `log_stats.data[0].values.push(use_size ? value.size : value.count)` with
  `parser.js:1080-1082` `const msg_size = msg.Size + 3` … `const size = msg_size * count` (bytes: `Size`
  sums the byte sizes of the format, plus the 3-byte header).
- `StreamStats.js:137` `log_stats.data[0].hovertemplate = plot_labels.pie_hovertemplate` with
  `StreamStats.js:656` `pie_hovertemplate: '%{label}<br>%{value:,i} bits<br>%{percent}<extra></extra>'`.
- The same function converts the same byte size to bits for the rate,
  `StreamStats.js:175` `bin_count(time, use_size ? (value.msg_size * 8) : 1, bin_width, total)`, and
  prints the same total as bytes, `StreamStats.js:146` `"Total size: " + log.data.byteLength + " Bytes"`.
- The tlog path stores bits for the same pie, `StreamStats.js:383` `msg.size.push(total_msg_length * 8)`,
  summed at `StreamStats.js:557` `composition[comp_name] = use_size ? array_sum(msg.size) : msg.size.length`.

**Minimal correct behaviour:** in Bits per second mode the `.bin` pie value of each type is
`size * 8` (IMU 1280, FMT 1424 in the reproduction), matching its "bits" hover. Shares are unchanged.

**Smallest port change:** multiply the per-type byte total by 8 where the port builds the `.bin`
composition in bits mode.

**Status:** FIXED (commit pending). Port: `apps/stream-stats/src/analysis/stats.ts:113`
(`m.totalBytes * 8`). Tests: `apps/stream-stats/src/analysis/stats.test.ts` › "matches upstream
plot_log on copter-sitl.bin / copter-files.bin (bits, 2 s / 10 s)" (identical to upstream with its pie
values × 8) and "plots bits in the bits pie (upstream: bytes) and lists types without records, as
upstream".

## 2. Parser's built-in FMT definition has no Size

**Row:** `modules/JsDataflashParser/parser.js` constructor (`FMT[128]`), `stats()`. "A log that never
defines FMT itself gives FMT a NaN size (pie value NaN)."

**Verdict:** PROVEN (contradicts itself).

**Reproduction:** `proofs/stream-stats/composition.test.ts` › "gives FMT a NaN msg_size and a NaN pie
value". Input: 100 zero bytes. `log.FMT[128].length` is `'89'`, `log.FMT[128].Size` is `undefined`,
`log.stats()` is `{ FMT: { count: 0, msg_size: NaN, size: NaN } }`, and in Bits per second mode the pie
is labels `['FMT']`, values `[NaN]`.

**Evidence:**

- `parser.js:234-240`: `this.FMT[128] = { Type: '128', length: '89', Name: 'FMT', Format: 'BBnNZ', Columns: [...] }`
  (no `Size`); `Size` is only set when an FMT record is read, `parser.js:704-720`.
- `parser.js:1079-1083`: `// All message have a 3 byte header` `const msg_size = msg.Size + 3` …
  `const size = msg_size * count`: `undefined + 3` is `NaN`, and `NaN * 0` is `NaN`.
- The same constructor states FMT's length as 89, which is also ArduPilot's
  (`upstream/modules/ardupilot/libraries/AP_Logger/LogStructure.h:187-194`, header + 1 + 1 + 4 + 16 + 64
  bytes, registered at `:1186` `{ LOG_FORMAT_MSG, sizeof(log_Format),`). Zero records occupy zero
  bytes; `size` of a zero-count type cannot be anything but 0.

Real ArduPilot logs define FMT themselves, so the effect is limited to files without that record; the
slice is not drawn either way.

**Minimal correct behaviour:** the built-in FMT entry reports `msg_size` 89, and a type with count 0
reports `size` 0.

**Smallest port change:** give the port's built-in FMT definition its record length (89, body 86) so
its stats are `{ count: 0, recordSize: 89, bytes: 0 }`.

**Status:** FIXED (commit pending). Port: `apps/stream-stats/src/analysis/bin.ts:58` (the NaN for the
built-in FMT definition is removed; `@apwt/dataflash` `stats()` already gives it 89 bytes). Test:
`apps/stream-stats/src/analysis/stats.test.ts` › "loads an empty file as an empty log; FMT is 0 bits,
where upstream has NaN".

## 3. Window size not validated

**Row:** `StreamStats/StreamStats.js` `plot_log`/`plot_tlog` (`parseFloat(WindowSize.value)`). "A
negative window gives negative rates and a total that drops every negative bin (empty if no bin is 0); 0
or an empty box makes `array_from_range` throw `Invalid array length` and nothing is replotted."

**Verdict:** PROVEN (it fails for 0 and empty; contradicts the page's own `min` for all three).

**Reproduction:** `proofs/stream-stats/window.test.ts`, same ten-record log, Messages per second:

- "window -4 gives negative messages per second and a one-point total": IMU `x` `[10, 6, 2, -2]`, `y`
  `[-0.25, -1, -1, -0.25]`; total `x` `[10, 6, 2, -2]`, `y` `[-0.25]`.
- "window "0" / "" throws RangeError: Invalid array length": `plot_log()` throws
  `RangeError: Invalid array length`. By then the pie has already been updated (`[10, 2]`) and the rate
  data cleared (`[]`); the total is never computed.

**Evidence:**

- The page declares the valid range: `upstream/StreamStats/index.html:84`
  `<input id="WindowSize" type="number" min="0.1" step="1" value="10" onchange="replot()" ...>`. `min` does
  not stop typed values, and `onchange` passes them on.
- `StreamStats.js:126` `const bin_width = parseFloat(document.getElementById("WindowSize").value)` (also
  `StreamStats.js:516` in `plot_tlog`) is used unchecked: `StreamStats.js:24`
  `ret[i] = Math.floor(time[i] / bin_width)` and `StreamStats.js:11`
  `array_from_range(low_bin, high_bin, 1.0)`, where `Array_Math.js:232-234`
  `const len = Math.floor((end - start) / step) + 1` … `new Array(len)` throws for the infinite/NaN bins
  of a 0 or NaN width.
- A message count per second over elapsed time cannot be negative.

**Minimal correct behaviour:** a window size that is not a number or is below the page's `min` of 0.1
is not plotted (the previous plots stay; an error may be shown). Valid sizes behave as now.

**Smallest port change:** before replotting, reject a window size that is `NaN` or `< 0.1` (the port
already reports the 0/empty error; extend the same check to negative and sub-0.1 values).

**Row correction:** "nothing is replotted" is not exact: for 0 or empty the composition pie is redrawn
first (`StreamStats.js:131-141` run before `bin_count`), and the rate data is cleared; only the rate and
total plots are not redrawn.

**Status:** FIXED (commit pending). Port: `apps/stream-stats/src/analysis/stats.ts:131`
(`streamStats` throws `RangeError: Window size must be a number of at least 0.1 s` for `NaN` or values
below `MIN_BIN_WIDTH` = 0.1; the page shows the error instead of plots). Tests:
`apps/stream-stats/src/analysis/stats.test.ts` › "rejects a negative window, where upstream plots
negative rates", "rejects a 0 s / NaN s window, where upstream throws while binning (or plots nothing
when everything is excluded)" and "rejects a negative window on copter-sitl.bin / copter-files.bin".
