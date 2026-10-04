# Log Finder bug proofs

Reproductions: [`proofs/log-finder/log-finder.test.ts`](../../proofs/log-finder/log-finder.test.ts). The harness
([`proofs/log-finder/_harness.ts`](../../proofs/log-finder/_harness.ts)) evaluates the original
`upstream/LogFinder/LogFinder.js` (with `Libraries/LogHelpers.js` and `Libraries/Param_Helpers.js`) in `node:vm`, runs
`initial_load()` as `<body onload>` does, and calls the original `setup_table(logs)`. `Tabulator` is a stand-in whose
behaviour comes from the original Tabulator 6.2.1 sources the page loads (`upstream/modules/tabulator`, version 6.2.1,
same code as `dist/js/tabulator.min.js`): row order and the sorter guess run `Sort.prototype.sort` (`findSorter`,
`_sortItems`, the sorter functions) on a copy of the rows in data order, as `RowManager.refreshPipelines` does, and
`getRows()` runs `RowManager.prototype.getComponents` / `getRows`. The rows are `{ info, fileHandle }` objects as
`load_from_dir` builds them.

| #   | Bug                                     | Verdict    | Reproduction                                                                                         |
| --- | --------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Ignore-checkbox re-diff uses data order | PROVEN     | `log-finder.test.ts` › "1. an ignore checkbox toggle re-diffs rows in data order, not display order" |
| 2   | Tabulator sorter guessed from first row | PROVEN     | `log-finder.test.ts` › "2. Flight Time sorter guessed from the first displayed row" (two cases)      |
| 3   | No natural name sort                    | NOT PROVEN | `log-finder.test.ts` › "3. Name column sorts 10.BIN before 9.BIN (guessed string sorter)"            |
| 4   | Size unit overflow                      | PROVEN     | `log-finder.test.ts` › "4. size_format has no unit from 1024 TB"                                     |
| 5   | Integer-like board lines reorder groups | NOT PROVEN | `log-finder.test.ts` › "5. a board named like an array index gets the first table"                   |

Totals: 3 PROVEN, 2 NOT PROVEN.

## 1. Ignore-checkbox re-diff uses data order

**Row.** Ignore-checkbox re-diff uses data order — `LogFinder.js` `initial_load` →
`update_param_diff(table, table.getRows())` — After a sort, toggling an ignore option diffs each row against the
previously scanned log until the next sort. Reproduced.

**Verdict.** PROVEN.

**Reproduction.** Three logs scanned in the order `c.bin` (2024-01-03, params `{X:1, Y:1}`), `a.bin` (2024-01-01,
`{X:1}`), `b.bin` (2024-01-02, `{X:1, Y:1}`). After the initial date sort the table shows `a, b, c` with Param Changes
`a: null`, `b: added {Y:1}`, `c: no change`. Unticking and re-ticking the first ignore checkbox (the ignore state is
then identical to the start) leaves the display order `a, b, c` but gives `a: missing {Y:1}`, `b: added {Y:1}`,
`c: null`, because `table.getRows()` returns `c, a, b`. The next sort (`setSort('info.time_stamp', 'asc')`) restores
the first result.

**Evidence.**

- The diff of a row is defined against the previous row of the list it is given, the first having none:
  `upstream/LogFinder/LogFinder.js:636-641`: `// Never any change in first row` /
  `rows[0].getData().param_diff = null` / … /
  `const param_diff = get_param_diff(rows[i].getData().info.params, rows[i-1].getData().info.params)`.
- On every sort the same function receives the displayed rows: `upstream/LogFinder/LogFinder.js:587`:
  `table.on("dataSorted", (sorters, rows) => { update_param_diff(table, rows) })`, where `rows` is the sorted list
  (`upstream/modules/tabulator/src/js/modules/Sort/Sort.js:394-399`).
- The checkbox handler passes data order instead: `upstream/LogFinder/LogFinder.js:828-830`:
  `function redraw_tables() {` / `for (const table of tables) {` / `update_param_diff(table, table.getRows())`.
  `getRows()` with no argument is `this.rows` (`upstream/modules/tabulator/src/js/core/Tabulator.js:686-687`,
  `core/RowManager.js:835-836`: `default:` / `rows = this.chain("rows-retrieve", type, null, this.rows) || this.rows;`),
  which sorting never reorders: the sort runs on a copy (`core/RowManager.js:718`:
  `this.activeRowsPipeline[0] = this.rows.slice(0);`, `:728`) and only `activeRows` takes the result.
- The checkbox's stated purpose is to ignore parameters, not to change what is compared:
  `upstream/LogFinder/index.html:49`: `data-tippy-content='Ignore parameter changes for the selected items when doing a
parameter compare. These parameters are expected to change each boot'`.

The code contradicts itself: for one and the same ignore state and display order, `update_param_diff` produces two
different Param Changes columns depending on whether it was last reached from `dataSorted` or from the checkbox; after
a toggle the top displayed row shows a diff, contrary to `// Never any change in first row`, and a row shows a diff
against a log that is not the one above it. A no-op toggle (off then on) changes the output.

**Row description.** Accurate, but it does not need a user sort: the table's own `initialSort` by date
(`LogFinder.js:582`) is enough whenever scan order differs from date order.

**Minimal correct behaviour.** Toggling an ignore option recomputes each row's diff against the row displayed directly
above it (the order `dataSorted` passes), with the top displayed row showing no change; i.e. the result equals what
the `dataSorted` handler computes for the current sort and the new ignore state. Upstream equivalent:
`update_param_diff(table, table.getRows("active"))`.

**Smallest port change.** On an ignore-option change, re-diff over the currently displayed (sorted) rows instead of
switching to data order: drop the data-order mode the port keeps for this case (the `afterIgnoreChange` path) and
reuse the current sort's row order.

**Status.** FIXED. `apps/log-finder/src/analysis/table.ts:283` (`buildTables` always diffs `sorted`;
the `diffOrder` / `afterIgnoreChange` data-order mode is removed, `App.tsx` `changeIgnored` only sets the ignore
state). Tests: `table-oracle.test.ts` › "ignore option change: upstream re-diffs in data order (proven bug), the port
in display order" (asserts upstream's data-order result, and that the port equals upstream's `dataSorted` result);
`table.test.ts` › "diffs in display order whatever the ignore options (upstream re-diffs in data order: proven bug)".

## 2. Tabulator sorter guessed from first row

**Row.** Tabulator sorter guessed from first row — Tabulator `findSorter` (Flight Time column) — If the first
displayed log has no `STAT_FLTTIME`, flight times sort as strings. Reproduced.

**Verdict.** PROVEN.

**Reproduction.** Logs by date: `first.bin` (no `flight_time`, as `load_log` leaves it without `STAT_FLTTIME`),
`five-min.bin` (`flight_time` 300), `one-min.bin` (`flight_time` 60). Clicking Flight Time ascending gives
`first.bin, five-min.bin, one-min.bin` (sorter `string`: `"300"` before `"60"`); after sorting by Size and back to
Flight Time descending the order is `one-min.bin, five-min.bin, first.bin` (the guess is kept). The same logs with
`first.bin` given `flight_time` 10 sort ascending as `first.bin, one-min.bin, five-min.bin` (sorter `number`).

**Evidence.**

- The column has no sorter: `upstream/LogFinder/LogFinder.js:577`:
  `{ title: "Flight Time", field:"info.flight_time", formatter:flight_time_format, bottomCalc:flight_time_bottom_calc, …`.
  Header sorting is left enabled (only Param Changes and the buttons set `headerSort:false`, `:579-580`).
- Tabulator guesses once, from the first active row, and stores the guess:
  `upstream/modules/tabulator/src/js/modules/Sort/Sort.js:303-304`: `var row = this.table.rowManager.activeRows[0],` /
  `sorter = "string",`; `:316-317`: `case "undefined":` / `sorter = "string";`; `:367-368`: `if(!sortObj.sorter){` /
  `sortObj.sorter = self.findSorter(item.column);`.
- The string sorter compares text: `modules/Sort/defaults/sorters/string.js:25`:
  `return String(a).toLowerCase().localeCompare(String(b).toLowerCase(), locale);`.
- `load_log` stores `flight_time` as a number of seconds (`LogFinder.js:692-695`,
  `flight_time = end_flight_time - start_flight_time`), and the column sums it (`flight_time_bottom_calc = … "sum"`,
  `:553`).

The UI offers "sort by Flight Time" and, in the first case, does not produce an order of flight times: ascending puts
300 s (shown as 5 min) before 60 s (1 min), which is not ascending in the quantity. The same column with the same
values sorts numerically when the first displayed row happens to carry a value, so the result depends only on which
log is listed first. No reading of the code makes a text ordering of a numeric duration column intended.

**Minimal correct behaviour.** Sorting by Flight Time orders the logs by `flight_time` numerically in both
directions, regardless of which row is first; logs without a flight time are placed as the number sorter places
empty values (Tabulator's `number` sorter, the one used when the first row has a value).

**Smallest port change.** Always use numeric comparison for the Flight Time column (the port's equivalent of
upstream setting `sorter:"number"` on that column), removing the first-row guess for it.

**Status.** FIXED. `apps/log-finder/src/analysis/table.ts:108` (`EXPLICIT_SORTERS` gives `flightTime`
the `number` sorter). Tests: `table-oracle.test.ts` › "Flight Time with an unknown first flight time: upstream guesses
string (proven bug), the port sorts numbers" (upstream order `x, y, z`; port `x, z, y`, equal to upstream's Tabulator
with the `number` sorter in both directions); `table.test.ts` › "guesses sorters from the first displayed row and keeps
them".

## 3. No natural name sort

**Row.** No natural name sort — Tabulator `string` sorter on Name — `10.BIN` sorts before `9.BIN`. Reproduced.

**Verdict.** NOT PROVEN.

**Reproduction.** Logs `9.BIN` and `10.BIN`; Name ascending gives `10.BIN, 9.BIN` (guessed sorter `string`).

**Evidence.** `upstream/LogFinder/LogFinder.js:574`: `{ title: "Name", field: "info.name", formatter:name_format },`
with no sorter; the guess for `"9.BIN"` is `string` (`Sort.js:325-329`: not a number, does not match the `alphanum`
pattern because of the `.`). Ordering names as text is a valid ordering of a text column, and nothing in Log Finder
states that the Name column should order numerically: the only `{numeric: true}` compare (`LogFinder.js:387-389`) is
the parameter list inside the diff tooltip. ArduPilot names its logs zero-padded
(`upstream/modules/ardupilot/libraries/AP_Logger/AP_Logger_File.cpp:380`: `"%s/%08u.BIN"`), so firmware-written names
sort correctly as text. A preference, not a proven bug; stays reproduced.

## 4. Size unit overflow

**Row.** Size unit overflow — `LogFinder.js` `size_format` — From 1024 TB the unit prints as `undefined`. Reproduced.

**Verdict.** PROVEN.

**Reproduction.** The Size column's formatter closure that `setup_table` passed to Tabulator, called with a cell:
`1024**4` → `"1.00 TB"`, `1000 * 1024**4` → `"1000.00 TB"`, `1024**5 - 1` → `"1.00 undefined"` (floating point:
`Math.log(1024**5 - 1) / Math.log(1024)` is 5), `1024**5` → `"1.00 undefined"`, `3 * 1024**6` → `"3.00 undefined"`.

**Evidence.** `upstream/LogFinder/LogFinder.js:340-346`: `// Make file size a nice string with units` / … /
`const unit_array = ['B', 'kB', 'MB', 'GB', 'TB']` /
`const unit_index = (size == 0) ? 0 : Math.floor(Math.log(size) / Math.log(1024))` / … /
`return scaled_size.toFixed(2) + " " + unit_array[unit_index]`. The comment states the result carries a unit;
from index 5 `unit_array[unit_index]` is `undefined` and the string ends in `undefined`. The same formatter renders
the Size column total (`bottomCalcFormatter:size_format`, `:575`). Not reachable with real single logs, but the
output contradicts the function's stated intent.

**Minimal correct behaviour.** The string always ends in a unit from the table, with the number scaled to that unit:
from 1024 TB (and for the one-byte-short floating-point case) it reads in TB, e.g. `1024**5` → `"1024.00 TB"`.

**Smallest port change.** Clamp the unit index to the last unit (`Math.min(index, 4)`) before scaling.

**Status.** FIXED. `apps/log-finder/src/analysis/format.ts:15` (unit index clamped to
`SIZE_UNITS.length - 1`). Tests: `table-oracle.test.ts` › "size_format from 1024 TB: upstream prints undefined (proven
bug), the port clamps to TB" (`1024**5 - 1` and `1024**5` → `1024.00 TB`, `2 * 1024**5` → `2048.00 TB`; upstream
`… undefined`); `format.test.ts` › "sizes with binary units". All smaller sizes stay identical (`size_format` oracle).

## 5. Integer-like board lines reorder groups

**Row.** Integer-like board lines reorder groups — `LogFinder.js` `setup_table` `Object.entries(boards)` — A board
whose boot line is e.g. `123` is listed first. Reproduced.

**Verdict.** NOT PROVEN.

**Reproduction.** Logs scanned as `a.bin` (`fc_string` `CubeOrange 0033003A`), `b.bin` (`fc_string` `123`), `c.bin`
(no `fc_string`): the board sections are `123: b.bin`, `CubeOrange 0033003A: a.bin`, `Unknown: c.bin`.

**Evidence.** `upstream/LogFinder/LogFinder.js:122-137`: `// Sort in to sections based on hardware ID` /
`let boards = {}` / … / `for (const [board_id, board_logs] of Object.entries(boards)) {`. `Object.entries` lists
integer-index keys first (ECMAScript `OrdinaryOwnPropertyKeys`), so the observed order is correct JavaScript. Nothing
in the original states the order the board sections should appear in (the comment only says logs are grouped by
hardware ID; scan order is itself filesystem iteration order). An ordering preference, not a proven bug; stays
reproduced.
