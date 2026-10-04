// Test-only: the proven upstream bugs the port fixes (docs/bug-proofs/pid-review.md), written as the
// smallest text edits to upstream PIDReview.js. Oracle tests load upstream with these edits
// (`createUpstreamPidReview({ fixed: true })`) so the port is still compared with the original side
// by side and everything the edits do not touch stays identical. Each edit must match exactly once.
// The original's own result for each bug is pinned in proofs/pid-review/ and in the tests that load
// the original.

/** One edit to upstream PIDReview.js. */
interface ProvenFix {
  /** Row in docs/bug-proofs/pid-review.md. */
  readonly row: number
  readonly find: string
  readonly replace: string
}

export const PROVEN_FIXES: readonly ProvenFix[] = [
  {
    // Batch rate: intervals over the span they cover
    row: 1,
    find: '                const sample_rate = 1 / ((time[j-1] - time[batch_start]) / count)\n',
    replace: '                const sample_rate = (j - 1 - batch_start) / (time[j-1] - time[batch_start])\n'
  },
  {
    // The batch ends at the split point (exclusive), so it includes sample j-1
    row: 2,
    find: 'batch_start: batch_start, batch_end: j-1})',
    replace: 'batch_start: batch_start, batch_end: j})'
  },
  {
    // Reflect the first real_len entries
    row: 3,
    find: '    sn = [...sn, ...sn.slice(1,real_len-1).reverse()]\n',
    replace: '    sn = sn.slice(0, real_len)\n    sn = [...sn, ...sn.slice(1,real_len-1).reverse()]\n'
  },
  {
    // Clear the mean trace with the individual one
    row: 4,
    find: '        step_plot.data[plot_index].x = []\n        step_plot.data[plot_index].y = []\n    }\n',
    replace:
      '        step_plot.data[plot_index].x = []\n        step_plot.data[plot_index].y = []\n        step_plot.data[plot_index+1].x = []\n        step_plot.data[plot_index+1].y = []\n    }\n'
  },
  {
    // Move the spectrogram to Out only when the selected option is disabled
    row: 5,
    find: '    if ((!have_all || !have_DFF) && disabled_checked) {\n',
    replace:
      '    if ((!have_all && (document.getElementById("Spec_Err").checked || document.getElementById("Spec_P").checked || document.getElementById("Spec_I").checked || document.getElementById("Spec_D").checked || document.getElementById("Spec_FF").checked)) || (!have_DFF && document.getElementById("Spec_DFF").checked)) {\n'
  }
]

/** Upstream PIDReview.js source with the proven fixes applied. */
export function applyProvenFixes(text: string): string {
  let out = text
  for (const fix of PROVEN_FIXES) {
    const at = out.indexOf(fix.find)
    if (at === -1 || out.indexOf(fix.find, at + 1) !== -1) {
      throw new Error(`Proven fix for row ${fix.row} does not match PIDReview.js exactly once`)
    }
    out = out.slice(0, at) + fix.replace + out.slice(at + fix.find.length)
  }
  return out
}
