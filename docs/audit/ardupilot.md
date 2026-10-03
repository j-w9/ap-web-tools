# Audit: `@apwt/ardupilot`

Upstream: `upstream/Libraries/DecodeDevID.js`, `upstream/Libraries/LogHelpers.js`,
`upstream/Libraries/Param_Helpers.js` and `upstream/{HardwareReport,LogFinder}/board_types.txt`
(the two copies are byte-identical) with the `load_board_types()` reader both tools carry.
Port: `packages/ardupilot/src/` (`devid.ts`, `version.ts`, `params.ts`, `board-types.ts`,
`board-types-data.ts`).

Oracle tests run the upstream libraries in `node:vm` (`src/test-utils/upstream.ts`):
`devid.test.ts` (structured sweep, random/negative/fractional ids, fixture ids),
`version.test.ts` (fixture logs and synthetic VER/MSG combinations), `params.test.ts`
(`param_to_string` on special and random values, NaN throw, download text, compass/vector names,
and, added in this audit, `get_param_value` values, console messages and the alert),
`board-types.test.ts` (compiled table against both upstream files).

## Inventory

| Upstream item                                                                                                                         | Port location                                                            | Status                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decode_devid(ID, type)` bit fields, bus/compass/IMU/baro/airspeed tables, `"Unknown"`, DroneCAN `sensor_id = devtype - 1`            | `devid.ts` `decodeDevId`                                                 | identical (names verbatim, incl. `"AK8963 "`, `"BMM150 "`, `"IMU: "`)                                                                                       |
| `decode_devid` with an unknown sensor class: `console.error`, returns `undefined`                                                     | `DeviceType` union                                                       | presentation: the type system rules the call out; no tool passes another class                                                                              |
| `print_device` text (Hardware Report) / MAGFit device text                                                                            | `devid.ts` `describeDevId`                                               | identical                                                                                                                                                   |
| `get_version_and_board(log)` VER first record, `GH` hex padding, `APJ` non-zero, `BU`, `FV`, custom firmware suffix with `?` defaults | `version.ts` `versionFromRecords`, `readVerRecord`, `getVersionAndBoard` | identical                                                                                                                                                   |
| `get_version_and_board` MSG scan (`fw_string` match, `Param space used:` three lines on, banner regex, OS and board lines)            | `version.ts` `versionFromRecords`                                        | identical                                                                                                                                                   |
| `get_base_log_message_types(log)`                                                                                                     | `DataflashLog.messageTypes()` keys                                       | identical (the port never lists `NAME[i]` entries)                                                                                                          |
| `get_param_name_vector3`, `get_compass_param_names`                                                                                   | `params.ts` `paramNameVector3`, `compassParamNames`                      | identical                                                                                                                                                   |
| `get_param_value(param_log, name, allow_change)` incl. `alert` and console text                                                       | `params.ts` `paramValue` (messages returned in `changes`)                | identical values; the alert/console text is returned for the caller to show (alert becomes an in-page message)                                              |
| `param_to_string(value)` (7/8/9 significant figures, throw)                                                                           | `params.ts` `paramToString`                                              | identical                                                                                                                                                   |
| `get_param_download_text(params)` natural sort, `NAME,value\n`                                                                        | `params.ts` `paramFileText`, `paramLine`, `compareParamNames`            | identical                                                                                                                                                   |
| `load_board_types(text)` (regex, prefix stripping, later lines win)                                                                   | `board-types.ts` `parseBoardTypes`                                       | identical                                                                                                                                                   |
| `fetch("board_types.txt")` at page load                                                                                               | `board-types-data.ts` compiled table, `BOARD_TYPES`, `boardName`         | browser-forced/equivalent: same data (checked against both upstream files by test); lookups are synchronous                                                 |
| `.param` file readers (not in the libraries; each tool has its own)                                                                   | `params.ts` `parseParamFile`                                             | not an upstream library function: tools whose upstream reader keeps junk lines must apply upstream's rules themselves (Hardware Report does, see its audit) |

## Remaining intentional differences

- **Board table bundled instead of fetched.** The compiled table equals what `load_board_types()`
  builds from the shipped `board_types.txt` (test `board-types.test.ts`). Upstream keys the table by
  the digit string, so an id written with a leading zero would not match a numeric board id; the
  shipped file has none, so lookups are identical. A failed fetch upstream leaves the table empty;
  the bundled table cannot fail.
- **`get_param_value` messages** are returned rather than logged/alerted; callers display them.
- **`parseParamFile`** skips comment and malformed lines. It is a shared convenience parser, not a
  port of a library function; each tool's audit checks that its results match that tool's upstream
  reader.

## Upstream bugs reproduced

| Location                                | Reproduction                                                                         | Effect                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `DecodeDevID.js` compass table          | Device id with devtype `0x04` or `0x05`                                              | Name has a trailing space (`"AK8963 "`, `"BMM150 "`), carried into report text |
| `DecodeDevID.js` `devtype = ID >> 16`   | Device id ≥ 2^31 (or negative)                                                       | Signed shift gives a negative devtype, so the name is `"Unknown"`              |
| `LogHelpers.js` `get_version_and_board` | Log whose banner is not followed by `Param space used:` exactly three messages later | OS string and flight controller stay undefined                                 |
