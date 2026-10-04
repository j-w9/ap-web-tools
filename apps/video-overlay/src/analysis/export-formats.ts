/**
 * Output container and codec choice for the export, ported from upstream `VideoOverlay.js`
 * (`loadCodecs`, `updateFormatSelection`, `MatchExportFormatToInput`). The browser probing is
 * injected so the selection logic is testable without WebCodecs.
 */

/** Output containers upstream offers, in its order. */
export const OUTPUT_FORMAT_NAMES = ['mp4', 'webm', 'mkv', 'mov'] as const
export type OutputFormatName = (typeof OUTPUT_FORMAT_NAMES)[number]

/** Frame rates upstream offers for the export; 30 is selected initially. */
export const FRAME_RATES = ['24', '25', '30', '48', '50', '60', '90', '100', '120', '240'] as const
export type FrameRate = (typeof FRAME_RATES)[number]
export const DEFAULT_FRAME_RATE: FrameRate = '30'

/** An output container the browser can encode, with the codecs it can encode into it. */
export interface OutputFormatOption {
  readonly name: OutputFormatName
  readonly video: readonly string[]
  readonly audio: readonly string[]
}

/** Encodable video and audio codecs for one container, as Mediabunny reports them. */
export type CodecProbe = (format: OutputFormatName) => Promise<{ video: readonly string[]; audio: readonly string[] }>

/** Upstream's error when no container has both an encodable video and audio codec. */
export const EXPORT_UNSUPPORTED_MESSAGE = 'Video export not supported by browser'

/**
 * Containers with at least one encodable video codec and one encodable audio codec, probed in
 * upstream's order. Throws {@link EXPORT_UNSUPPORTED_MESSAGE} when there are none.
 */
export async function probeOutputFormats(probe: CodecProbe): Promise<readonly OutputFormatOption[]> {
  const formats: OutputFormatOption[] = []
  for (const name of OUTPUT_FORMAT_NAMES) {
    const { video, audio } = await probe(name)
    if (video.length > 0 && audio.length > 0) formats.push({ name, video, audio })
  }
  if (formats.length === 0) throw new Error(EXPORT_UNSUPPORTED_MESSAGE)
  return formats
}

/** The export's container and codecs, as upstream's three selects hold them. */
export interface FormatSelection {
  readonly format: OutputFormatName
  readonly videoCodec: string
  readonly audioCodec: string
}

/** Selection after picking a container: its first video and audio codec (upstream `updateFormatSelection`). */
export function selectFormat(option: OutputFormatOption): FormatSelection {
  return { format: option.name, videoCodec: option.video[0] ?? '', audioCodec: option.audio[0] ?? '' }
}

/** Initial selection: the first available container (the select's first option). */
export function initialSelection(formats: readonly OutputFormatOption[]): FormatSelection | null {
  const first = formats[0]
  return first ? selectFormat(first) : null
}

/** A codec select is locked when it offers a single codec (upstream `updateCodecOptions`). */
export function codecLocked(codecs: readonly string[]): boolean {
  return codecs.length === 1
}

/**
 * What upstream reads from a loaded video to pre-fill the export (`input.addEventListener('change')`).
 * Codecs are `null` when Mediabunny cannot name them.
 */
export interface InputMediaDescription {
  /** Mediabunny input format name, e.g. "MP4". */
  readonly formatName: string
  readonly videoCodec: string | null
  /** `undefined` when the video has no audio track. */
  readonly audioCodec: string | null | undefined
  /** Average packet rate formatted with two decimals, e.g. "29.97". */
  readonly fps: string
}

/**
 * The Codec info text: `video + audio` as upstream wrote it (a codec Mediabunny cannot name shows as
 * `null`), or the video codec alone for a video without an audio track (proven bug #120: upstream
 * threw there).
 */
export function inputCodecText(videoCodec: string | null, audioCodec: string | null | undefined): string {
  return audioCodec === undefined ? String(videoCodec) : `${String(videoCodec)} + ${String(audioCodec)}`
}

/**
 * Match the export settings to the input video where possible (upstream `MatchExportFormatToInput`):
 * the container with the same name (case-insensitive, which resets the codecs to that container's
 * first), then the same video and audio codec if offered, then the nearest frame rate (first on
 * ties). Anything without a match is left as it was. A codec Mediabunny could not name (null)
 * makes upstream throw part way; the steps done until then stand and `error` carries the message.
 * Without an audio track (`audioCodec` undefined) the audio codec is left as it was: upstream threw
 * before matching anything there, a proven bug (docs/bug-proofs/video-overlay.md #120).
 */
export function matchSelectionToInput(
  formats: readonly OutputFormatOption[],
  current: { readonly selection: FormatSelection | null; readonly frameRate: FrameRate },
  input: InputMediaDescription
): { selection: FormatSelection | null; frameRate: FrameRate; error?: string } {
  let selection = current.selection
  let frameRate = current.frameRate
  const nullCodecError = "Cannot read properties of null (reading 'toLowerCase')"
  const wanted = input.formatName.toLowerCase()
  const format = formats.find((f) => f.name.toLowerCase() === wanted)
  if (format) selection = selectFormat(format)

  const offered = formats.find((f) => f.name === selection?.format)
  // Upstream only lower-cases the wanted codec while comparing it with an option, so a null codec
  // throws only when the select has options.
  const videoOptions = offered?.video ?? []
  if (input.videoCodec === null && videoOptions.length > 0) return { selection, frameRate, error: nullCodecError }
  const videoWanted = input.videoCodec?.toLowerCase()
  const video = videoOptions.find((c) => c.toLowerCase() === videoWanted)
  if (selection && video !== undefined) selection = { ...selection, videoCodec: video }
  if (input.audioCodec !== undefined) {
    const audioOptions = offered?.audio ?? []
    if (input.audioCodec === null && audioOptions.length > 0) return { selection, frameRate, error: nullCodecError }
    const audioWanted = input.audioCodec?.toLowerCase()
    const audio = audioOptions.find((c) => c.toLowerCase() === audioWanted)
    if (selection && audio !== undefined) selection = { ...selection, audioCodec: audio }
  }

  let minDiff = Infinity
  for (const rate of FRAME_RATES) {
    const diff = Math.abs(parseFloat(rate) - parseFloat(input.fps))
    if (diff < minDiff) {
      minDiff = diff
      frameRate = rate
    }
  }
  return { selection, frameRate }
}
