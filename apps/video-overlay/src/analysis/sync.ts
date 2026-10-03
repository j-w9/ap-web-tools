/**
 * Video/log time synchronisation and the small time calculations of the player and exporter,
 * ported from upstream `VideoOverlay.js`. All times here are seconds; the log's own clock is
 * seconds since boot (`TimeUS * 1e-6`), the video's is `HTMLVideoElement.currentTime`.
 */

/**
 * The log offset as the user typed it. Upstream keeps it in a number input and reads it with
 * `parseFloat` each time, so an empty or partial entry gives NaN; the text is kept to match.
 */
export type OffsetText = string

/** Format a number the way an `<input type="number">` shows a value assigned from script. */
export function offsetTextFromSeconds(offsetS: number): OffsetText {
  return String(offsetS)
}

/**
 * Log time shown at a video time (upstream `setWidgetTime`): `logTime = videoTime - offset`.
 * Increasing the offset advances the log relative to the video.
 */
export function logTimeAtVideoTime(videoTimeS: number, offset: OffsetText): number {
  return videoTimeS - parseFloat(offset)
}

/**
 * Video time of an exported frame: Mediabunny's sample timestamps are relative to the trimmed
 * output, so the trim start is added back (upstream `exportVideo` process callback).
 */
export function exportFrameVideoTimeS(sampleTimestampS: number, trimStartS: number): number {
  return sampleTimestampS + trimStartS
}

/** Export progress as upstream prints it on the loading overlay, e.g. "42.17%". */
export function exportProgressText(sampleTimestampS: number, trimStartS: number, trimEndS: number): string {
  return `${((sampleTimestampS / (trimEndS - trimStartS)) * 100).toFixed(2)}%`
}

/** Export progress as a 0..1 fraction (same ratio as {@link exportProgressText}). */
export function exportProgressFraction(sampleTimestampS: number, trimStartS: number, trimEndS: number): number {
  return sampleTimestampS / (trimEndS - trimStartS)
}

/** Export speed statistics, as upstream logs them to the console. */
export interface ExportStats {
  /** Wall-clock time the export took, seconds. */
  readonly exportTimeS: number
  /** Frames encoded per wall-clock second. */
  readonly exportFps: number
  /** Video seconds per wall-clock second. */
  readonly timeRatio: number
}

export function exportStats(exportTimeS: number, trimStartS: number, trimEndS: number, fps: number): ExportStats {
  const originalTime = trimEndS - trimStartS
  return { exportTimeS, exportFps: (originalTime * fps) / exportTimeS, timeRatio: originalTime / exportTimeS }
}

/** Upstream's console line for {@link ExportStats}. */
export function exportStatsText(stats: ExportStats): string {
  return `Export took: ${stats.exportTimeS.toFixed(2)}s, ${stats.exportFps.toFixed(2)} FPS, ${(stats.timeRatio * 100).toFixed(2)}% realtime`
}

/** Player time display, `m:ss` (upstream `formatTime`). */
export function formatPlayerTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, '0')
  return `${m}:${s}`
}

/** Seek-bar position 0..1 for a video time (upstream `updateTimeline`, which treats 0/NaN duration as 1). */
export function seekFraction(currentTimeS: number, durationS: number): number {
  return currentTimeS / (durationS || 1)
}

/** Video time for a seek-bar position (upstream `seek.oninput`). */
export function seekTime(fraction: number, durationS: number): number {
  return fraction * durationS
}

/** One frame at the export frame rate, the step of the frame buttons (upstream `frame-back`/`frame-fwd`). */
export function frameStepS(frameRate: string): number {
  return 1 / parseFloat(frameRate)
}

/** Seconds skipped by the skip buttons. */
export const SKIP_S = 5

/**
 * Highlighted export range on the seek bar as percentages (upstream `updateSeekBar`), from the
 * start and end time inputs as typed.
 */
export function trimRangePercent(startText: string, endText: string, durationS: number): { start: number; end: number } {
  return { start: (parseFloat(startText) / durationS) * 100, end: (parseFloat(endText) / durationS) * 100 }
}
