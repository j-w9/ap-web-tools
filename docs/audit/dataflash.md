# Audit: `@apwt/dataflash` (JsDataflashParser port)

Upstream: `upstream/modules/JsDataflashParser/parser.js` (class `DataflashParser`).
Port: `packages/dataflash/src/` (`DataflashLog` in `log.ts`, scan in `scan.ts`, FMT and field
decoding in `format.ts`/`decode.ts`, FMTU units in `units.ts`, instances in `instances.ts`, mode
tables in `modes.ts`).

The requirement is that every ported tool receives the values its upstream tool received from
JsDataflashParser. The API shape differs on purpose (columns are typed arrays of the natural
width, data is decoded lazily and cached, instances are numbers); values do not.

Oracle tests: `src/oracle.test.ts` (every column of every message and instance on two real logs,
parameters, mode names, start time) and `src/oracle-edges.test.ts` (added in this audit: `stats()`,
embedded files, FMTU units/multipliers/instances on real logs, and synthetic logs for the file
concatenation, FMTU abort and unsizeable formats). The upstream loader is
`src/test-support/upstream-parser.ts`.

## Inventory

| Upstream item                                                                                                                              | Port location                                                   | Status                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DfReader()` header search `A3 95`, offsets recorded for every id, known ids skipped by `Size`, unknown ids stepped byte by byte           | `scan.ts` `scanLog`                                             | identical                                                                                                                                                         |
| FMT record decode (`FORMAT_TO_STRUCT`, `BBnNZ`), FMT redefinition overwrites                                                               | `format.ts` `decodeFmtRecord`, `scan.ts`                        | identical                                                                                                                                                         |
| Truncated FMT at end of buffer: exception, `offset += 1`                                                                                   | `scan.ts`                                                       | identical                                                                                                                                                         |
| FMT with a type code `get_size_of` does not know: `Size` = NaN, scan ends at that type's first record                                      | `scan.ts` `unsized`                                             | reverted-in-this-audit (port skipped the type and kept scanning)                                                                                                  |
| Last record of each type dropped when it overruns the buffer                                                                               | `scan.ts`                                                       | identical                                                                                                                                                         |
| `parse_type` for every type code (`Q`/`q` 64-bit composition, `c C e E` /100, strings Latin-1 with trailing NULs stripped, `a` = 32 int16) | `format.ts` `readNumber`/`readString`, `decode.ts`              | identical (values; arrays are typed per width)                                                                                                                    |
| `populateUnits()` from FMTU, last FMTU per type wins                                                                                       | `log.ts` `readFmtu`                                             | identical                                                                                                                                                         |
| `populateUnits()` throws on a FMTU for a type with no FMT and abandons all later FMTU records                                              | `log.ts` `readFmtu`                                             | proven upstream bug fixed (see "Proven upstream bugs fixed"): the record is skipped, later FMTU records are applied                                               |
| Units resolved from the built-in `units`/`multipliers` tables only                                                                         | `log.ts` `buildMessageTypes`, `units.ts`                        | reverted-in-this-audit (port layered the log's UNIT/MULT tables on top)                                                                                           |
| `complexFields[].units` = `multipliersTable[mult] + unit`, `multipliersTable` = {1e-6: `n`, 1e3: `M`, 1e-3: `m`}                           | `units.ts` `SI_PREFIXES`                                        | identical except 1e-6, labelled `µ` (proven upstream bug fixed, see "Proven upstream bugs fixed")                                                                 |
| `checkNumberOfInstances()`: split on the first `#` field, instance keys ascending                                                          | `log.ts`, `instances.ts`                                        | identical                                                                                                                                                         |
| `messageTypes` lists types with at least one record (`Total_Length != 0`), `expressions` = columns                                         | `log.ts` `messageTypes()`, `MessageTypeInfo.fieldNames`         | identical                                                                                                                                                         |
| `get(name, field)` / `get(name)` on a non-instanced type                                                                                   | `get`, `getNumbers`, `getStrings`, `getMessage`                 | identical                                                                                                                                                         |
| `get_instance(name, inst, field)`                                                                                                          | `getInstance`, `getMessage(name, inst)`                         | identical                                                                                                                                                         |
| `get()` on an instanced type: throws (`OffsetArray` was deleted)                                                                           | `get` returns all instances in log order                        | presentation (API); callers are audited per tool so no tool reads merged data where upstream threw                                                                |
| `parseAtOffset()` renaming `TimeUS` to `time_boot_ms` (/1000) and adding `MODE.asText`                                                     | not ported as such; `TimeUS` stays in µs, `modes()` gives names | presentation: neither Hardware Report nor Log Finder reads `time_boot_ms` or `asText` (Hardware Report only calls `parseAtOffset('FILE')`, which has no `TimeUS`) |
| `processFiles()`: `Data` text of every FILE record appended in log order per `FileName`; `Offset`/`Length` ignored                         | `log.ts` `files()`                                              | proven upstream bug fixed (see "Proven upstream bugs fixed"): `Length` bytes placed at `Offset`, a new copy at Offset 0 replaces the old                          |
| `stats()`: every defined FMT, in id order, including zero-record types                                                                     | `log.ts` `stats()`                                              | reverted-in-this-audit (port omitted zero-record types)                                                                                                           |
| `extractStartTime()` (first `TimeUS`, first 3D GPS fix per instance, leap seconds)                                                         | `log.ts` `startTime()`, `firstTimeUs()`, `leapSecondsGps/Tai`   | identical                                                                                                                                                         |
| `getModeString()` vehicle from MSG text, mode tables                                                                                       | `modes.ts`, `vehicleType()`, `modeName()`                       | not used by Hardware Report or Log Finder (they never parse MODE); kept for other tools, whose audits own it                                                      |
| Worker `postMessage` protocol, `trimFile`                                                                                                  | not ported                                                      | browser plumbing; no tool in this scope uses it                                                                                                                   |

## Remaining intentional differences

- **Typed columns.** Numeric columns are `Int16Array`, `Float32Array`, ... instead of
  `Float64Array`. Every element reads back as the same double, so values are identical.
- **`get()` on instanced messages** returns the merged records instead of throwing. Tools must use
  `getInstance` where upstream used `get_instance`; Hardware Report and Log Finder audits checked
  every call site.
- **Units for ids missing from the tables.** Upstream produces the string `"undefined"` (unit) and
  `undefined` (multiplier); the port gives `'?'` and `1`. No tool reads field units.
- **Unsizeable formats.** Upstream keeps the type (count 1, NaN sizes) in `messageTypes` and
  `stats()` and throws when it is decoded; the port leaves it out. The scan stops at the same
  record in both, so every other type's data is identical.
- **FMT column lists that do not match the format length.** Upstream keeps `split(',')` as is
  (an empty list becomes `['']`, extra names have no offset); the port pads with `fieldN` or
  truncates so every column has an offset. ArduPilot never writes such FMT records.
- **Text or array instance fields** are not split (upstream would split on the string). ArduPilot
  never marks such a field with `#`.
- **Crashes.** Old-style GPS without `GWk`/`GMS`, MODE without MSG and a missing `Data` column
  throw upstream; the port returns `undefined`/empty.

## Upstream bugs reproduced

| Location                   | Reproduction                                                                      | Effect                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DfReader()` `get_size_of` | A FMT whose format contains an unknown type code, followed by a record of that id | `Size` is NaN, the read offset becomes NaN and the scan ends: every later record is lost |

## Proven upstream bugs fixed

Proven to the standard in [`../bug-proofs/README.md`](../bug-proofs/README.md); verdicts, evidence and
tests in [`../bug-proofs/js-dataflash-parser.md`](../bug-proofs/js-dataflash-parser.md). The oracle tests
still run upstream on the bug input, assert its result and the port's corrected one, and match it
everywhere else.

| Location           | Reproduction                                                                   | Upstream                                                  | Port                                                                     |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `processFiles()`   | `copter-files.bin`: `@SYS/uarts.txt`, `memory.txt`, `threads.txt` logged twice | Both copies appended (`uarts.txt` 1664 bytes)             | Chunks at `Offset`; the copy starting at Offset 0 replaces the old (832) |
| `processFiles()`   | `copter-files.bin` `@SYS/storage.bin` (64-byte chunks ending in zeros)         | Trailing zeros of each chunk dropped (171 bytes)          | `Length` bytes of every chunk (32768 bytes)                              |
| `multipliersTable` | Any FMTU with multiplier `F` (1e-6), e.g. `TimeUS`                             | `ns`                                                      | `µs`                                                                     |
| `populateUnits()`  | A FMTU for a message id with no FMT, followed by other FMTU records            | Throws; every later FMTU ignored (no units, no instances) | That record skipped; later FMTU records applied                          |
