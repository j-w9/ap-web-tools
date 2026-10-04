# JsDataflashParser bug proofs

Rows for `JsDataflashParser` in [`../upstream-bugs.md`](../upstream-bugs.md). Original code:
`upstream/modules/JsDataflashParser/parser.js`. Tests: `proofs/js-dataflash-parser/`.

| #   | Bug                                                          | Verdict    | Reproduction                                                   |
| --- | ------------------------------------------------------------ | ---------- | -------------------------------------------------------------- |
| 1   | FILE chunks appended in log order, `Offset`/`Length` ignored | PROVEN     | `files.test.ts` (both cases)                                   |
| 2   | `multipliersTable` maps 1e-6 to `n`                          | PROVEN     | `units.test.ts` › "labels a TimeUS field … as ns"              |
| 3   | FMTU for an undefined type aborts unit loading               | PROVEN     | `units.test.ts` › "throws at an FMTU for a type with no FMT …" |
| 4   | Unknown type code ends the scan                              | NOT PROVEN | `scan.test.ts`                                                 |

## 1. FILE chunks appended in log order, `Offset`/`Length` ignored

**Row:** `modules/JsDataflashParser/parser.js` `processFiles`. "A file written twice holds both copies
(`copter-files.bin` `@SYS/uarts.txt` is 1664 bytes, not 832); trailing zero bytes of each 64-byte chunk
are dropped, so binary files (crash dumps) are shorter and misaligned."

**Verdict:** PROVEN (contradicts ArduPilot).

**Reproduction:** `proofs/js-dataflash-parser/files.test.ts`, on the real fixture
`packages/dataflash/test-fixtures/copter-files.bin`, files built as Hardware Report builds them
(`parseAtOffset('FILE')` then `processFiles()`):

- "appends a second copy of @SYS/uarts.txt (Offset restarts at 0) after the first": the log holds 26
  FILE records for `@SYS/uarts.txt`, Offsets `0, 64, …, 768, 0, 64, …, 768`, every Length 64, so the
  largest `Offset + Length` is 832. The original's file is 1664 bytes: bytes 832–1663 are the second
  copy, which the log places at Offsets 0–831. (The two copies differ, the file holds counters, so the
  result is not even a repeated file.)
- "drops the trailing zero bytes of every chunk of the binary @SYS/storage.bin": 512 records with
  Offsets `0, 64, …, 32704`, every Length 64 (a 32768-byte file). The decoded `Data` strings are 63,
  64, 21, … characters long, and the original's file is **171 bytes** instead of 32768.

**Evidence:**

- The original ignores `Offset` and `Length` and concatenates `Data`, `parser.js:815-826`:
  `const Data = this.messages.FILE.Data[i]` … `this.files[name] = this.concatTypedArrays(this.files[name], this.createUint8ArrayFromString(Data))`.
- `Data` is decoded as a NUL-stripped string, `parser.js:351`:
  `ret = String.fromCharCode.apply(null, new Uint8Array(this.buffer, this.offset, 64)).replace(/\x00+$/g, '')`.
- ArduPilot defines the record: `upstream/modules/ardupilot/libraries/AP_Logger/LogStructure.h:623-628`
  `struct PACKED log_File { LOG_PACKET_HEADER; char filename[16]; uint32_t offset; uint8_t length; char data[64]; };`
- ArduPilot fills `data` with raw file bytes, `length` with the number read and `offset` with their
  position in the file, `upstream/modules/ardupilot/libraries/AP_Logger/AP_Logger.cpp:1750`
  `const auto length = AP::FS().read(file_content.fd, pkt.data, sizeof(pkt.data));`, `:1757`
  `pkt.offset = file_content.offset;`, `:1758` `pkt.length = length;`, `:1760`
  `file_content.offset += length;`. A file is re-read from the start with `offset` reset,
  `AP_Logger.cpp:1734` `file_content.fd  = AP::FS().open(file->filename, O_RDONLY);` and `:1740`
  `file_content.offset = 0;`.

So the bytes of a record belong at `offset … offset + length - 1` of the file, all `length` of them
(zeros included). The original puts a second read at the end and drops valid zero bytes.

**Minimal correct behaviour:** take exactly `Length` bytes of the raw 64-byte `Data` field (no NUL
stripping) and place them at `Offset`. A record with `Offset` 0 for a file already seen starts a new
read of that file (`AP_Logger.cpp:1740`), so it must not be appended to the previous copy: keep the
latest copy (or each copy separately). For `copter-files.bin`: `@SYS/uarts.txt` is 832 bytes (the
second read), `@SYS/storage.bin` is 32768 bytes.

**Smallest port change:** in the port's file reassembly (`@apwt/dataflash` `files()`), read `Data` as
raw bytes, slice to `Length`, write at `Offset` into a buffer sized `max(Offset + Length)`, and restart
the buffer when a record with `Offset` 0 arrives for a name that already has data.

**Status:** FIXED. Port: `packages/dataflash/src/log.ts:445` (`DataflashLog.files()`;
a FILE format without `Offset`/`Length` columns keeps upstream's assembly). Tests:
`packages/dataflash/src/oracle-edges.test.ts` › "matches the embedded files" (copter-files.bin: every
file identical to upstream except the four affected) and "places file chunks at Offset with Length
bytes, keeping the last copy (upstream appends them; proven bug)"; `oracle.test.ts` › "reassembles
embedded files" (`@SYS/uarts.txt` 832 bytes, `@SYS/storage.bin` 32768); `files.test.ts`; Hardware
Report `oracle-log.test.ts` (FILES downloads). In `copter-files.bin` `@SYS/uarts.txt`,
`@SYS/memory.txt` and `@SYS/threads.txt` are logged twice and `@SYS/storage.bin` has zero-ended
chunks.

## 2. `multipliersTable` maps 1e-6 to `n`

**Row:** `parser.js` `multipliersTable`. "`TimeUS` and other 1e-6 fields are labelled `ns` instead of
`µs`."

**Verdict:** PROVEN (contradicts the SI prefix definitions the table implements, and itself).

**Reproduction:** `proofs/js-dataflash-parser/units.test.ts` › "labels a TimeUS field (unit s,
multiplier F = 1e-6) as ns": on `copter-sitl.bin`, `messageTypes.IMU.complexFields.TimeUS` is
`{ name: 'TimeUS', units: 'ns', multiplier: 0.000001 }`. The control case "labels a 1e-3 multiplier with
the SI prefix m (same table)" gives `ms` for a field with unit `s` and multiplier `C`.

**Evidence:**

- `parser.js:146-150`: `const multipliersTable = { 0.000001: 'n', 1000: 'M', 0.001: 'm' }`, used at
  `parser.js:1014` `units: !msg.units ? '?' : (multipliersTable[msg.multipliers[i]] || '') + msg.units[i]`.
  The table maps a multiplier value to the SI prefix written before the base unit; its `0.001: 'm'`
  entry is the SI prefix milli.
- ArduPilot: `upstream/modules/ardupilot/libraries/AP_Logger/LogStructure.h:105` `{ 'F', 1e-6 },` and
  `:102` `{ 'C', 1e-3 },`; the field is named `TimeUS` (microseconds) with units `s` and multiplier `F`,
  e.g. `LogStructure.h:1304` `"SCR",   "QNIii", "TimeUS,Name,Runtime,Total_mem,Run_mem", "s#sbb", "F-F--"`.
- SI Brochure (BIPM, 9th edition, Table 7): prefix `µ` (micro) = 10⁻⁶, prefix `n` (nano) = 10⁻⁹.

The label for 1e-6 is the prefix for 1e-9: every `F` field is labelled 1000x too small.

**Minimal correct behaviour:** multiplier 1e-6 is labelled with the prefix `µ` (`TimeUS` → `µs`).
(The `1000: 'M'` entry is also not the SI prefix for 10³, which is `k`, but no ArduPilot multiplier is
1000, `LogStructure.h:93-111`, so it is unreachable and outside this row.)

**Smallest port change:** in the port's multiplier-prefix table, map 1e-6 to `µ` instead of `n`.

**Status:** FIXED. Port: `packages/dataflash/src/units.ts:70` (1e-6 → `µ`, U+00B5).
Tests: `packages/dataflash/src/oracle-edges.test.ts` › "matches units, multipliers and instances"
(every label identical to upstream except `n` → `µ` for 1e-6) and "splits instances and applies the
built-in units when FMTU is valid"; `log.test.ts` › "resolves units and multipliers from the built-in
tables, as upstream does".

## 3. FMTU for an undefined type aborts unit loading

**Row:** `parser.js` `populateUnits` (throws, caught once). "Every later FMTU is ignored: those messages
get no units and are not split into instances."

**Verdict:** PROVEN (it fails: the original throws).

**Reproduction:** `proofs/js-dataflash-parser/units.test.ts` › "throws at an FMTU for a type with no FMT
and ignores every later FMTU": a synthetic log with `FMTU` for type 99 (no FMT), then a valid `FMTU` for
`IMU` (`s#O`, `F--`), then four `IMU` records with instances 0 and 1. The original logs
`'error populating units'` followed by `TypeError: Cannot set properties of undefined (setting 'units')`;
`IMU.complexFields.TimeUS` is `{ name: 'TimeUS', units: '?', multiplier: 1 }` and `IMU.instances` is
`undefined`. The control case without the bad record splits `IMU` into `{ 0: 'IMU[0]', 1: 'IMU[1]' }`.

**Evidence:**

- `parser.js:835-837`: `for (const index in FMTU.FmtType) { const type = FMTU.FmtType[index]; this.FMT[type].units = []`
  throws when `this.FMT[type]` is undefined; the loop over every FMTU record is abandoned at that point.
- `parser.js:1001-1006`: `try{ this.populateUnits() } catch (e) { console.log('error populating units'); console.log(e) }`:
  the original itself reports the outcome as an error.

The input does not come from a healthy ArduPilot log (the firmware writes every FMT before any FMTU,
`upstream/modules/ardupilot/libraries/AP_Logger/LoggerMessageWriter.cpp:110-125` and `:173-181`, and
`AP_Logger_Backend.cpp:187-192` returns before `Write_Format_Units` if `Write_Format` fails), so it needs
a log where that FMT record is lost or corrupted. The verdict rests on the throw, not on frequency.

**Minimal correct behaviour:** an FMTU whose type has no FMT is skipped and the remaining FMTU records
are still applied (in the reproduction `IMU` gets `TimeUS` in seconds-with-1e-6 and is split into
instances 0 and 1).

**Smallest port change:** in the port's FMTU handling, `continue` past records whose type is undefined
instead of stopping unit loading.

**Status:** FIXED. Port: `packages/dataflash/src/log.ts:572` (`readFmtu`: `continue`
instead of `break`). Test: `packages/dataflash/src/oracle-edges.test.ts` › "skips a FMTU record for an
undefined type (upstream abandons every later FMTU; proven bug)" (upstream: `IMU` units `?`, no
instances; port: `µs`, instances `[0, 1]`, the same fields as upstream for the log without the bad
record).

## 4. Unknown type code ends the scan

**Row:** `parser.js` `DfReader` (`get_size_of` undefined, offset NaN). "Every record after the first
record of that type is lost."

**Verdict:** NOT PROVEN.

**Reproduction:** `proofs/js-dataflash-parser/scan.test.ts` › "sizes a format with an unknown type code
as NaN and stops at its first record": FMT for id 40 with format `Qx`, an `IMU` record, a record of id
40, then two more `IMU` records. `FMT[40].Size` is `NaN`, the parser's `offset` ends as `NaN`, and
`stats().IMU` is `{ count: 1, msg_size: 16, size: 16 }` (the two later records are lost).

**Evidence:**

- `parser.js:710` `Size += this.get_size_of(value.Format.charAt(i))` (`get_size_of`, `parser.js:388-417`,
  returns `undefined` for codes it does not list); `parser.js:723` `this.offset += this.FMT[attribute].Size`;
  `parser.js:684` `while (this.offset < (this.buffer.byteLength - 3))` is false for `NaN`.

**Why not proven:** nothing throws (the `catch` at `parser.js:725-729` is never reached), and the
original states no intended handling for unknown type codes. `get_size_of` covers every format
character ArduPilot defines at the pinned commit
(`upstream/modules/ardupilot/libraries/AP_Logger/LogStructure.h:8-28`: `a b B h H i I f d n N Z c C e E L M q Q`),
so an ArduPilot log never contains such a format, and no firmware definition says what the record
should decode to. Stopping, skipping or resynchronising are all readings the code does not choose
between. Stays reproduced.

**Status:** not fixed (not proven); reproduced as before.
