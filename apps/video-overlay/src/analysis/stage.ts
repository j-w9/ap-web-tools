/**
 * Size of the video and overlay stage (upstream `matchOverlaySize`): the video fitted inside the
 * available box keeping its aspect ratio, 16:9 before a video is loaded, rounded down to whole
 * pixels. The overlay grid covers exactly this box, so widget positions are relative to the video.
 */
export function stageSize(
  maxWidth: number,
  maxHeight: number,
  videoWidth: number,
  videoHeight: number
): { width: number; height: number } {
  const containerRatio = maxWidth / maxHeight
  let videoRatio = videoWidth / videoHeight
  if (isNaN(videoRatio)) videoRatio = 16 / 9
  let width: number
  let height: number
  if (videoRatio > containerRatio) {
    width = maxWidth
    height = maxWidth / videoRatio
  } else {
    height = maxHeight
    width = maxHeight * videoRatio
  }
  return { width: Math.floor(width), height: Math.floor(height) }
}

/** Upstream caps the stage at 1200 px wide and 1200 px or 80 % of the window high. */
export const STAGE_MAX_PX = 1200
export const STAGE_HEIGHT_FRACTION = 0.8
