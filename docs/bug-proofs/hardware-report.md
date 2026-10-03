# Hardware Report bug proofs

Verdicts for the Hardware Report rows of [`../upstream-bugs.md`](../upstream-bugs.md), under the
standard in [`README.md`](README.md). All reproductions are in
`proofs/hardware-report/hardware-report.test.ts`. They run the original
`upstream/HardwareReport/HardwareReport.js` (with `DecodeDevID.js`, `Array_Math.js`,
`Param_Helpers.js`, `LogHelpers.js` and the upstream JsDataflashParser) in `node:vm` through
`proofs/hardware-report/_harness.ts`. Synthetic logs are built with `@apwt/dataflash/testing`.
Firmware citations are to `upstream/modules/ardupilot` at `f3836cf`.

| #   | Bug                                                              | Verdict    | Reproduction (describe in `hardware-report.test.ts`)                        |
| --- | ---------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| 1   | Accel calibration checks offsets against 1.0                     | PROVEN     | "Hardware Report 1: accel calibration checks offsets against 1.0"           |
| 2   | Gyro temperature-cal names reuse `ACC1..3`; max temperature TMAN | PROVEN     | "Hardware Report 2: gyro temperature-cal names reuse ACC1..3; ..."          |
| 3   | Accel and gyro health swapped                                    | PROVEN     | "Hardware Report 3: accel and gyro health swapped"                          |
| 4   | Duplicate `case 4` in fault names                                | PROVEN     | "Hardware Report 4: duplicate case 4 in fault names"                        |
| 5   | Signed shift in `decode_ICSR`                                    | PROVEN     | "Hardware Report 5: signed shift in decode_ICSR"                            |
| 6   | Internal error names stop at bit 29                              | NOT PROVEN | "Hardware Report 6: internal error names stop at bit 29"                    |
| 7   | `.param` reader keeps junk lines                                 | PROVEN     | "Hardware Report 7: .param reader keeps junk lines"                         |
| 8   | NaN position offset hides the plot                               | NOT PROVEN | "Hardware Report 8: NaN position offset hides the plot"                     |
| 9   | CAN bitrate `parseInt(undefined)`                                | NOT PROVEN | "Hardware Report 9: CAN bitrate parseInt(undefined)"                        |
| 10  | Boot message naming an unconfigured GPS                          | PROVEN     | "Hardware Report 10: boot message naming an unconfigured GPS" (and control) |
| 11  | Zero-record types in the stats pie                               | NOT PROVEN | "Hardware Report 11: zero-record types in the stats pie"                    |

Totals: 7 PROVEN, 4 NOT PROVEN. Row 6 is mis-described: the name table is exactly the one the
pinned firmware defines (see below). Row 2 has one part (`TMAN`) with no observable effect.

## 1. Accel calibration checks offsets against 1.0

**Row.** Accel calibration checks offsets against 1.0 · `HardwareReport.js` `load_ins`
(`accel_scale = get_param_array(params, names.accel.offset)`) · Accel calibration shows ✅ for
uncalibrated IMUs; scale factors never checked. Reproduced.

**Verdict.** PROVEN (contradicts itself; contradicts ArduPilot).

**Reproduction.** "reads the accel scale array from the offset names and marks default
(uncalibrated) parameters calibrated": a `.param` file with `INS_GYR_ID`/`INS_ACC_ID` set,
`INS_ACCOFFS_X/Y/Z = 0` and `INS_ACCSCAL_X/Y/Z = 1` (the firmware defaults). Upstream gives
`get_ins_param_names(0).accel.scale` = `['INS_ACCSCAL_X','INS_ACCSCAL_Y','INS_ACCSCAL_Z']`, yet
`ins[0].acc_cal === 1` and the INS section reads `Accel calibration: ✅`. "ignores a scale
calibration when the offsets are exactly 1": offsets 1,1,1 with scales 1.05/0.98/1.01 also give
`acc_cal === 1`; the scale values are never read.

**Evidence.**

- `upstream/HardwareReport/HardwareReport.js:796` builds the scale names:
  `scale: get_param_name_vector3(acc_prefix + "SCAL_"),`
- `upstream/HardwareReport/HardwareReport.js:834` reads the offsets into the scale variable:
  `const accel_scale = get_param_array(params, names.accel.offset)`
- `upstream/HardwareReport/HardwareReport.js:853` compares that against the scale default:
  `acc_cal: param_array_configured(accel_offsets, 0.0) | param_array_configured(accel_scale, 1.0),`
- `upstream/modules/ardupilot/libraries/AP_InertialSensor/AP_InertialSensor.cpp:209`
  `AP_GROUPINFO("_ACCSCAL",     12, AP_InertialSensor, _accel_scale_old_param[0],  1.0),` and
  `:234` `AP_GROUPINFO("_ACCOFFS",     13, AP_InertialSensor, _accel_offset_old_param[0], 0),`:
  the uncalibrated state is offsets 0 and scales 1, which upstream reports as calibrated.

**Minimal correct behaviour.** `acc_cal` is true iff any `INS_ACC*OFFS_*` differs from 0 or any
`INS_ACC*SCAL_*` differs from 1; with firmware defaults it is ❌.

**Smallest port change.** Read the scale array from `names.accel.scale` instead of
`names.accel.offset` (one identifier).

## 2. Gyro temperature-cal names reuse `ACC1..3`; max temperature named `TMAN`

**Row.** Gyro temperature-cal names reuse `ACC1..3`; max temperature named `TMAN` ·
`HardwareReport.js` `get_ins_param_names` · Gyro temperature calibration follows the accel
coefficients. Reproduced.

**Verdict.** PROVEN for the gyro names (contradicts ArduPilot; contradicts itself). The `TMAN` name
also does not exist in ArduPilot, but `tcal.t_max` is never read by upstream, so it has no
observable effect and needs no fix.

**Reproduction.** "builds ACC names for the gyro coefficients and TMAN for the maximum
temperature": `get_ins_param_names(0).tcal` returns `t_max: 'INS_TCAL1_TMAN'` and `gyro` equal to
`accel` (`INS_TCAL1_ACC1_X` … `INS_TCAL1_ACC3_Z`). "reports gyro temperature calibration absent
when only the gyro coefficients are set": `INS_TCAL1_ENABLE 1`, all `INS_TCAL1_GYRn_*` = 0.3, all
`ACCn_*` = 0 → `Gyro temperature calibration: ❌`. "... present when only the accel coefficients are
set": `ACCn_*` = 0.2, `GYRn_*` = 0 → `Gyro temperature calibration: ✅`.

**Evidence.**

- `upstream/HardwareReport/HardwareReport.js:803` `t_max: tcal_prefix + "TMAN",`
- `upstream/HardwareReport/HardwareReport.js:807` `gyro: [ get_param_name_vector3(tcal_prefix + "ACC1_"),`
  (and the two following lines `ACC2_`, `ACC3_`), used at `:844-845` as `gyro_coefficients`.
- `upstream/modules/ardupilot/libraries/AP_InertialSensor/AP_InertialSensor_tempcal.cpp:155`
  `AP_GROUPINFO("GYR1", 7, AP_InertialSensor_TCal, gyro_coeff[0], 0),` (`GYR2` at `:175`, `GYR3`
  at `:195`); `:75` `AP_GROUPINFO("TMAX", 3, AP_InertialSensor_TCal, temp_max,  70),`; the group is
  mounted as `_TCAL1_` at `libraries/AP_InertialSensor/AP_InertialSensor.cpp:605`.
- Searching `HardwareReport.js` for `t_max` finds only the definition at `:803`.

**Minimal correct behaviour.** `gyro_temp_cal` is true iff `INS_TCALn_ENABLE > 0` and any
`INS_TCALn_GYR{1,2,3}_{X,Y,Z}` is non-zero.

**Smallest port change.** Build the gyro coefficient names with `GYR1_`/`GYR2_`/`GYR3_`. Optionally
rename `TMAN` to `TMAX` (no output changes).

## 3. Accel and gyro health swapped

**Row.** Accel and gyro health swapped · `HardwareReport.js` `print_ins` · "Accel health" shows the
gyro flag and vice versa. Reproduced.

**Verdict.** PROVEN (contradicts itself; contradicts ArduPilot).

**Reproduction.** "prints the GH flag as "Accel health" and the AH flag as "Gyro health"": IMU
instance 0 logged twice with `AH = 1`, `GH = 0`. Upstream has `ins[0].acc_all_healthy === true`,
`gyro_all_healthy === false`, and prints `Accel health: ❌` and `Gyro health: ✅`.

**Evidence.**

- `upstream/HardwareReport/HardwareReport.js:867-868`
  `ins[i].acc_all_healthy = array_all_equal(log.get_instance("IMU", inst, "AH"), 1)` /
  `ins[i].gyro_all_healthy = array_all_equal(log.get_instance("IMU", inst, "GH"), 1)`
- `upstream/HardwareReport/HardwareReport.js:916`
  `"Accel health: " + (params.gyro_all_healthy ? ...` and `:921`
  `"Gyro health: " + (params.acc_all_healthy ? ...`
- `upstream/modules/ardupilot/libraries/AP_InertialSensor/LogStructure.h:58-59`
  `// @Field: GH: gyroscope health` / `// @Field: AH: accelerometer health`.

**Minimal correct behaviour.** "Accel health" shows whether every `AH` is 1, "Gyro health" whether
every `GH` is 1.

**Smallest port change.** Swap the two flags in the two health lines.

## 4. Duplicate `case 4` in fault names

**Row.** Duplicate `case 4` in fault names · `HardwareReport.js` `show_watchdog` · Fault types 5/6
(BusFault/UsageFault) show no name. Reproduced.

**Verdict.** PROVEN (contradicts itself: duplicated `case` label; contradicts ArduPilot).

**Reproduction.** "fault type %i renders ...": a `WDOG` record with `FT` 3, 4, 5, 6. Upstream
prints `Fault Type: 3 (HardFault)`, `Fault Type: 4 (MemManage)`, and for 5 and 6 no name
(`Fault Type: 5` directly followed by `Fault Address`).

**Evidence.**

- `upstream/HardwareReport/HardwareReport.js:336`, `:339`, `:342`: three `case 4:` labels; the
  second and third carry `fault_name = "BusFault"` (`:340`) and `fault_name = "UsageFault"`
  (`:343`) and can never be reached.
- `upstream/modules/ardupilot/libraries/AP_HAL_ChibiOS/hwdef/common/stm32_util.h:163-165`
  `MemManage = 4,` / `BusFault = 5,` / `UsageFault = 6,` (the `FaultType` passed to
  `save_fault_watchdog`, logged as `WDOG.FT`, `libraries/AP_HAL_ChibiOS/LogStructure.h:48`).

**Minimal correct behaviour.** `FT` 5 → `(BusFault)`, `FT` 6 → `(UsageFault)`.

**Smallest port change.** Use labels 5 and 6 for the last two names.

## 5. Signed shift in `decode_ICSR`

**Row.** Signed shift in `decode_ICSR` · `HardwareReport.js` `decode_ICSR` · ICSR bit 31 reads
`0x-1`. Reproduced.

**Verdict.** PROVEN (contradicts mathematics / itself).

**Reproduction.** "decodes ICSR bit 31 as NMIPENDSET 0x-1": `WDOG.ICSR = 0x80000000`. Upstream
prints `Fault ICS Register: 0x80000000` and `NMIPENDSET: 0x-1  (NMI pending)`. Control: bit 28
alone gives `PENDSVSET: 0x1  (PendSV pending)`.

**Evidence.**

- `upstream/HardwareReport/HardwareReport.js:463` `["31", "NMIPENDSET", decoder_m4_nmipendset],`
  declares a one-bit field; a one-bit field's value is 0 or 1.
- `:483` `mask |= (1 << i)` and `:485` `let value = (ICSR & mask) >> start_bit`: `1 << 31` is
  `-2147483648` in JavaScript and `>>` is an arithmetic shift, so the extracted value is `-1`.
- The register is unsigned: `upstream/modules/ardupilot/libraries/AP_HAL_ChibiOS/LogStructure.h:68`
  `uint32_t fault_icsr;`, logged as `I` (`:77`).

**Minimal correct behaviour.** Each field prints its unsigned bit value; NMIPENDSET with bit 31 set
prints `0x1`. The decoder text is unchanged (already "NMI pending").

**Smallest port change.** Extract with an unsigned shift (`>>>`) or `(ICSR >>> start) & width_mask`.

## 6. Internal error names stop at bit 29

**Row.** Internal error names stop at bit 29 · `HardwareReport.js` `show_internal_errors` · Bits
30/31 are named `undefined`. Reproduced.

**Verdict.** NOT PROVEN. Mis-described: the table matches the pinned firmware exactly; bits 30/31
are not defined internal errors.

**Reproduction.** "names bit 29 "invalid arguments"": `MON.IErr = 0x20000000` →
`0x20000000: invalid arguments`. "names bit 30 "undefined"": `MON.IErr = 0x40000000` →
`0x40000000: undefined`.

**Evidence.**

- `upstream/HardwareReport/HardwareReport.js:655` the 30th and last entry: `"invalid arguments",`
- `upstream/modules/ardupilot/libraries/AP_InternalError/AP_InternalError.h:73-74`
  `invalid_arg_or_result       = (1U << 29),` / `__LAST__                    = (1U << 30),  // used only for sanity check`,
  and `AP_InternalError.cpp:76` asserts exactly that many descriptions. The firmware never sets bits
  30/31, so no reference defines a name for them.

## 7. `.param` reader keeps junk lines

**Row.** `.param` reader keeps junk lines · `HardwareReport.js` `load_param_file` · Comments and
malformed lines become NaN entries; saving then fails with "Could not convert NaN to float
string". Reproduced.

**Verdict.** PROVEN (it fails: the offered "Save All Parameters" throws; contradicts ArduPilot's
parameter-file format).

**Reproduction.** "stores a "# comment" line as a NaN parameter and Save All Parameters throws":
the file
`# we need small INS_ACC offsets so INS is recognised as being calibrated\nINS_GYR_ID,1\nINS_ACC_ID,1\n`
(the comment line is ArduPilot's `Tools/autotest/default_params/copter.parm:51`). Upstream's
`params` has keys `['#', 'INS_GYR_ID', 'INS_ACC_ID']` with `params['#']` NaN; the download section
is shown (`ParametersContent.hidden === false`) and `save_all_parameters()` throws
`Could not convert NaN to float string`; nothing is saved. Control: without the comment line the
file saves as `INS_ACC_ID,1\nINS_GYR_ID,1\n`.

**Evidence.**

- `upstream/HardwareReport/index.html:38` `accept=".param,.parm,.bin"` (the page offers `.parm`).
- `upstream/HardwareReport/HardwareReport.js:1708-1712` `v = line.split(/[\s,=\t]+/)` /
  `if (v.length >= 2) {` / … / `params[name] = parseFloat(value)`.
- `upstream/HardwareReport/HardwareReport.js:3700` `save_text(get_param_download_text(params), ".param")`;
  `upstream/Libraries/Param_Helpers.js:102` `text += key + "," + param_to_string(params[key]) + "\n";`;
  `:89` `throw new Error("Could not convert " + value.toString() + " to float string")`.
- `upstream/modules/ardupilot/libraries/AP_Param/AP_Param.cpp:2272-2273` in `parse_param_line`:
  `if (line[0] == '#') {` / `return false;` (comment lines are not parameters).

**Minimal correct behaviour.** A line whose first character is `#` is skipped, so a `.parm` file
with comments loads without a `#` parameter and "Save All Parameters" saves it.

**Smallest port change.** Skip lines starting with `#` before splitting. (Other junk the row lists,
such as `NAME,` or a leading-whitespace line, is not covered by this proof: the firmware parser
behaves differently from upstream there too, but it is not a definition of what the report must
show; keep those reproduced.)

## 8. NaN position offset hides the plot

**Row.** NaN position offset hides the plot · `HardwareReport.js` `update_pos_plot`
(`max_offset > 0`) · The whole sensor-offset plot is hidden. Reproduced.

**Verdict.** NOT PROVEN.

**Reproduction.** "hides the whole offset plot when one offset reads NaN": `INS_POS1_X,abc` (with
IMU 2 at a valid `INS_POS2_X,0.2`) → `POS_OFFSETS` container hidden. Control: a numeric offset
shows the plot.

**Evidence.** `upstream/HardwareReport/HardwareReport.js:1488`
`return (pos[0] != null) && (pos[1] != null) && (pos[2] != null)`, `:1496`
`max_offset = Math.max(max_offset, Math.abs(pos[0]), ...)`, `:1542` `const have_plot = max_offset > 0`.
A NaN offset only arises from a non-numeric value in a hand-edited `.param` file; nothing in the
code, the page or ArduPilot states what the plot should show for such input. Hiding the plot on
an unreadable offset is a reasonable reading.

## 9. CAN bitrate `parseInt(undefined)`

**Row.** CAN bitrate `parseInt(undefined)` · `HardwareReport.js` `plot_data_rate` · Missing
`CAN_Pn_BITRATE` gives title `NaNMbit/s` and no limit line. Reproduced.

**Verdict.** NOT PROVEN.

**Reproduction.** "titles a CAN driver without CAN_Pn_BITRATE "NaNMbit/s"": `CAN_P1_DRIVER 1`, no
`CAN_P1_BITRATE`, `CANS` instance 0 → title `DroneCAN 0: NaNMbit/s`. Control: with
`CAN_P1_BITRATE 1000000` → `DroneCAN 0: 1Mbit/s`.

**Evidence.** `upstream/HardwareReport/HardwareReport.js:2416`
`bitrate = parseInt(params["CAN_P" + i + "_BITRATE"])`, `:2425-2426` `if (bitrate != null) {` /
`title += ": " + (bitrate/1000000) + "Mbit/s"`. The input cannot come from the pinned firmware:
`upstream/modules/ardupilot/libraries/AP_CANManager/AP_CANIfaceParams.cpp:29` `DRIVER` is the
group's enable parameter and `:36` `AP_GROUPINFO("BITRATE", 2, ...)` is unconditional, so a log
with `CAN_Pn_DRIVER` non-zero always has `CAN_Pn_BITRATE`. No reference defines the title for a
log missing it.

Note (outside this row, not proven here): the CAN-FD branch
(`parseInt(params["CAN_P" + i + "_FDBITRATE"]) * 1000000`, `:2418`) reads a parameter that only
exists `#if HAL_CANFD_SUPPORTED` (`AP_CANIfaceParams.cpp:38-45`), while the option bit it keys on
(`CAN_Dn_UC_OPTION` bit 2, `libraries/AP_DroneCAN/AP_DroneCAN.cpp:132`) exists on every board. That
path is reachable from real logs and would print the same `NaNMbit/s`; it would need its own row
and proof.

## 10. Boot message naming an unconfigured GPS

**Row.** Boot message naming an unconfigured GPS · `HardwareReport.js` `load_gps` (`gps[i]`
undefined) · Upstream throws and the page is left half built; the port stops with an error.
Reproduced as a crash.

**Verdict.** PROVEN (it fails: the original throws and does not build its own report).

**Reproduction.** "throws when a MSG names GPS 2 and GPS2 is disabled in the final parameters":
`PARM GPS1_TYPE 1, GPS2_TYPE 9` at 1 ms, `MSG "GPS 2: specified as DroneCAN1-125"` at 2 ms (the
firmware's own wording), `PARM GPS2_TYPE 0` at 3 ms. Upstream's `load_log` rejects with
`TypeError: Cannot set properties of undefined (setting 'device')`; the GPS section stays hidden
although GPS 1 is configured, and `ParametersContent` (revealed later in `load_params`) stays
hidden. Control: without the final `GPS2_TYPE 0`, `gps[1].device` is `DroneCAN1-125`.

**Evidence.**

- `upstream/HardwareReport/HardwareReport.js:2575` `params[name] = value` (the last logged value
  wins), so `gps[1]` is not created (`:1310` `if (type != 0) {`, the per-instance `GPSn_TYPE` branch).
- `upstream/HardwareReport/HardwareReport.js:1331-1333` `if ((num_match != null) && (device_match != null)) {`
  / `const gps_num = parseInt(num_match[0]) - 1` / `gps[gps_num].device = device_match[0]`.
- `upstream/modules/ardupilot/libraries/AP_GPS/GPS_Backend.cpp:142` `"GPS %d: specified as %s",`.

**Minimal correct behaviour.** A detection message for a GPS instance that is not configured is
ignored and the rest of the report is built.

**Smallest port change.** Skip the message when `gps[gps_num]` is absent, instead of stopping with
an error.

## 11. Zero-record types in the stats pie

**Row.** Zero-record types in the stats pie · `HardwareReport.js` `load_log` `log.stats()` · Types
defined but never written appear as pie labels. Reproduced.

**Verdict.** NOT PROVEN.

**Reproduction.** "lists types defined by FMT but never written, with value 0": `copter-sitl.bin`
gives pie labels whose values are 0 (all values ≥ 0).

**Evidence.** `upstream/HardwareReport/HardwareReport.js:3012-3014` pushes every `log.stats()`
entry (`log_stats.data[0].values.push(value.size)`); `upstream/modules/JsDataflashParser/parser.js:1077-1083`
returns every defined format with `size = msg_size * count`. A zero slice is a correct share of 0
bytes; no reference states that unused types must be omitted.
