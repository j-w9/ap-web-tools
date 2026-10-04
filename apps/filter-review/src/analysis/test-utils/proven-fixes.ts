// Test-only: the proven upstream bugs the port fixes (docs/bug-proofs/filter-review.md), written
// as the smallest text edits to the original scripts. Oracle tests load upstream with these edits
// (`{ fixed: true }`) wherever their input reaches a fixed bug, so the port is still compared with
// the original side by side and everything the edits do not touch stays identical. Each edit must
// match exactly once. The original's own result for each bug is pinned in proofs/filter-review/.
//
// Row 9 (drop-down values) and row 13 (crash on an invalid loop rate) have no edit: row 9 lives
// in the page's `<select>` semantics (the page stub applies it with `fixed`, see upstream-page.ts),
// row 13 only replaces a crash with an error message.

/** One edit to an upstream file. */
interface ProvenFix {
  /** Row in docs/bug-proofs/filter-review.md. */
  readonly row: number
  /** Upstream file the edit applies to, relative to `upstream/`. */
  readonly file: string
  readonly find: string
  readonly replace: string
}

export const PROVEN_FIXES: readonly ProvenFix[] = [
  {
    // Read the log type choice before reset() ticks "Raw sensor"
    row: 1,
    file: 'FilterReview/FilterReview.js',
    find: '    // Reset buttons and labels\n    reset()\n',
    replace:
      '    const proven_fix_batch_choice = document.getElementById("log_type_batch").checked\n    // Reset buttons and labels\n    reset()\n'
  },
  {
    row: 1,
    file: 'FilterReview/FilterReview.js',
    find: '        use_batch = document.getElementById("log_type_batch").checked\n',
    // The radios show the choice used (reset() ticked "Raw sensor")
    replace:
      '        use_batch = proven_fix_batch_choice\n        document.getElementById(use_batch ? "log_type_batch" : "log_type_raw").checked = true\n'
  },
  {
    // Slice raw batches to `j`, not `j - instance`
    row: 2,
    file: 'FilterReview/FilterReview.js',
    find: '                                        x: GyrX.slice(batch_start, j-i),\n                                        y: GyrY.slice(batch_start, j-i),\n                                        z: GyrZ.slice(batch_start, j-i) })',
    replace:
      '                                        x: GyrX.slice(batch_start, j),\n                                        y: GyrY.slice(batch_start, j),\n                                        z: GyrZ.slice(batch_start, j) })'
  },
  {
    // Reported raw rate by sensor number, as load_from_batch
    row: 3,
    file: 'FilterReview/FilterReview.js',
    find: '        if (gyro_rate[i] != null) {\n            // Make sure rate is at least the reported sampling rate\n            Gyro_batch[i].gyro_rate = Math.max(gyro_rate[i], Gyro_batch[i].gyro_rate)',
    replace:
      '        if (gyro_rate[Gyro_batch[i].sensor_num] != null) {\n            // Make sure rate is at least the reported sampling rate\n            Gyro_batch[i].gyro_rate = Math.max(gyro_rate[Gyro_batch[i].sensor_num], Gyro_batch[i].gyro_rate)'
  },
  {
    // Average the rates of the batches the FFT uses, once window_size is known (with no such
    // batch, the original's value)
    row: 4,
    file: 'FilterReview/FilterReview.js',
    find: '    var sample_rate_sum = 0\n    var sample_rate_count = 0\n    for (let i=0;i<num_batch;i++) {\n        if (data_set[i].x.length < window_size) {\n            // Log section is too short, skip\n            continue\n        }\n        sample_rate_count++\n        sample_rate_sum += data_set[0].sample_rate\n    }\n\n    // Average sample time\n    const sample_time = sample_rate_count / sample_rate_sum\n',
    replace: ''
  },
  {
    row: 4,
    file: 'FilterReview/FilterReview.js',
    find: '    const window_spacing = Math.round(window_size * (1 - window_overlap))\n    const windowing_function = hanning(window_size)\n',
    replace:
      '    var sample_rate_sum = 0\n    var sample_rate_count = 0\n    for (let i=0;i<num_batch;i++) {\n        if (data_set[i].x.length < window_size) {\n            continue\n        }\n        sample_rate_count++\n        sample_rate_sum += data_set[i].sample_rate\n    }\n    if (sample_rate_count == 0) {\n        for (let i=0;i<num_batch;i++) {\n            sample_rate_count++\n            sample_rate_sum += data_set[0].sample_rate\n        }\n    }\n    const sample_time = sample_rate_count / sample_rate_sum\n\n    const window_spacing = Math.round(window_size * (1 - window_overlap))\n    const windowing_function = hanning(window_size)\n'
  },
  {
    // A throttle found at index 0 is found
    row: 5,
    file: 'FilterReview/FilterReview.js',
    find: '        if (first_index) {\n',
    replace: '        if (first_index >= 0) {\n'
  },
  {
    row: 5,
    file: 'FilterReview/FilterReview.js',
    find: '        if (last_index) {\n',
    replace: '        if (last_index >= 0) {\n'
  },
  {
    // Interpolate FTN1 only when it is logged
    row: 7,
    file: 'FilterReview/tracking/FFT.js',
    find: '        this.data.interpolated[instance].value = linear_interp(this.data.value, this.data.time, time)\n',
    replace:
      '        if (this.data.value != null) {\n            this.data.interpolated[instance].value = linear_interp(this.data.value, this.data.time, time)\n        }\n'
  },
  {
    // The centre peak needs only FTN1
    row: 6,
    file: 'FilterReview/tracking/FFT.js',
    find: ' || (this.data.interpolated[instance].length == 0)) {\n',
    replace: ') {\n'
  },
  {
    // No centre peak without FTN1
    row: 7,
    file: 'FilterReview/tracking/FFT.js',
    find: '        return [this.get_target(config, this.data.interpolated[instance].value[index])]\n',
    replace:
      '        if (this.data.interpolated[instance].value == null) {\n            return null\n        }\n        return [this.get_target(config, this.data.interpolated[instance].value[index])]\n'
  },
  {
    // Skip a parameter file line whose input cannot be set
    row: 10,
    file: 'FilterReview/FilterReview.js',
    find: '            if (parameter_set_value(vname, value)) {\n                console.log("set " + vname + "=" + value)\n            }\n',
    replace:
      '            try {\n                if (parameter_set_value(vname, value)) {\n                    console.log("set " + vname + "=" + value)\n                }\n            } catch (e) {\n            }\n'
  },
  {
    // Max and min of a single window are distinct arrays
    row: 12,
    file: 'FilterReview/FilterReview.js',
    find: '            Phase_min = HR_phase\n',
    replace: '            Phase_min = HR_phase.slice()\n'
  }
]

/** `text` (the upstream `file`) with the proven fixes for that file applied. */
export function applyProvenFixes(file: string, text: string): string {
  let out = text
  for (const fix of PROVEN_FIXES) {
    if (fix.file !== file) continue
    const at = out.indexOf(fix.find)
    if (at === -1 || out.indexOf(fix.find, at + 1) !== -1) {
      throw new Error(`Proven fix for row ${fix.row} does not match ${file} exactly once`)
    }
    out = out.slice(0, at) + fix.replace + out.slice(at + fix.find.length)
  }
  return out
}
