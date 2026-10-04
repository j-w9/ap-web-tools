import { describe, expect, it } from 'vitest'
import {
  codecLocked,
  EXPORT_UNSUPPORTED_MESSAGE,
  initialSelection,
  inputCodecText,
  matchSelectionToInput,
  probeOutputFormats,
  selectFormat,
  type CodecProbe,
  type OutputFormatOption
} from './export-formats.js'

const FORMATS: readonly OutputFormatOption[] = [
  { name: 'mp4', video: ['avc', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus'] },
  { name: 'webm', video: ['vp8', 'vp9', 'av1'], audio: ['opus'] },
  { name: 'mov', video: ['avc', 'hevc'], audio: ['aac'] }
]

describe('codec probing', () => {
  it('keeps containers with both an encodable video and audio codec, in upstream order', async () => {
    const seen: string[] = []
    const probe: CodecProbe = (name) => {
      seen.push(name)
      return Promise.resolve(name === 'mkv' ? { video: ['avc'], audio: [] } : { video: ['avc'], audio: ['aac'] })
    }
    const formats = await probeOutputFormats(probe)
    expect(seen).toEqual(['mp4', 'webm', 'mkv', 'mov'])
    expect(formats.map((f) => f.name)).toEqual(['mp4', 'webm', 'mov'])
  })

  it('throws upstream message when nothing can be encoded', async () => {
    await expect(probeOutputFormats(() => Promise.resolve({ video: [], audio: ['aac'] }))).rejects.toThrow(
      EXPORT_UNSUPPORTED_MESSAGE
    )
  })
})

describe('selection', () => {
  it('starts on the first container and its first codecs; locks single-codec lists', () => {
    expect(initialSelection(FORMATS)).toEqual({ format: 'mp4', videoCodec: 'avc', audioCodec: 'aac' })
    expect(initialSelection([])).toBeNull()
    expect(selectFormat(FORMATS[1]!)).toEqual({ format: 'webm', videoCodec: 'vp8', audioCodec: 'opus' })
    expect(codecLocked(['opus'])).toBe(true)
    expect(codecLocked(['aac', 'opus'])).toBe(false)
  })

  const start = { selection: initialSelection(FORMATS), frameRate: '30' as const }

  it('matches container, codecs and nearest frame rate to the input', () => {
    expect(
      matchSelectionToInput(FORMATS, start, { formatName: 'WebM', videoCodec: 'VP9', audioCodec: 'opus', fps: '59.94' })
    ).toEqual({
      selection: { format: 'webm', videoCodec: 'vp9', audioCodec: 'opus' },
      frameRate: '60'
    })
  })

  it('keeps the current container when the input format is not offered, and picks the first rate on ties', () => {
    const result = matchSelectionToInput(FORMATS, start, {
      formatName: 'Matroska',
      videoCodec: 'hevc',
      audioCodec: 'flac',
      fps: '27.50'
    })
    expect(result).toEqual({ selection: { format: 'mp4', videoCodec: 'hevc', audioCodec: 'aac' }, frameRate: '25' })
  })

  it('resets the codecs when the container changes, even if the input codec is not offered there', () => {
    const current = { selection: { format: 'mp4' as const, videoCodec: 'av1', audioCodec: 'opus' }, frameRate: '30' as const }
    const result = matchSelectionToInput(FORMATS, current, {
      formatName: 'MOV',
      videoCodec: 'prores',
      audioCodec: 'pcm-s16',
      fps: '24.00'
    })
    expect(result).toEqual({ selection: { format: 'mov', videoCodec: 'avc', audioCodec: 'aac' }, frameRate: '24' })
  })

  it('stops part way, like upstream throwing, when a codec has no name', () => {
    const result = matchSelectionToInput(FORMATS, start, { formatName: 'WebM', videoCodec: null, audioCodec: 'opus', fps: '60' })
    expect(result.selection).toEqual({ format: 'webm', videoCodec: 'vp8', audioCodec: 'opus' })
    expect(result.frameRate).toBe('30')
    expect(result.error).toMatch(/toLowerCase/)
  })

  it('matches a video without an audio track except for the audio codec (proven upstream bug #120)', () => {
    // Upstream threw reading the missing track's codec before matching anything (reproduced in
    // proofs/video-overlay). Corrected: container, video codec and frame rate are matched as for a
    // video with audio; the audio codec keeps the container's default.
    const withAudio = matchSelectionToInput(FORMATS, start, {
      formatName: 'WebM',
      videoCodec: 'VP9',
      audioCodec: 'opus',
      fps: '59.94'
    })
    const withoutAudio = matchSelectionToInput(FORMATS, start, {
      formatName: 'MP4',
      videoCodec: 'hevc',
      audioCodec: undefined,
      fps: '29.97'
    })
    expect(withAudio).toEqual({ selection: { format: 'webm', videoCodec: 'vp9', audioCodec: 'opus' }, frameRate: '60' })
    expect(withoutAudio).toEqual({ selection: { format: 'mp4', videoCodec: 'hevc', audioCodec: 'aac' }, frameRate: '30' })
  })

  it('writes the codec info as upstream, and the video codec alone without an audio track (proven bug #120)', () => {
    expect(inputCodecText('avc', 'aac')).toBe('avc + aac')
    expect(inputCodecText(null, null)).toBe('null + null')
    expect(inputCodecText('avc', undefined)).toBe('avc')
  })

  it('still matches the frame rate when no formats could be probed', () => {
    expect(
      matchSelectionToInput(
        [],
        { selection: null, frameRate: '30' },
        { formatName: 'MP4', videoCodec: null, audioCodec: null, fps: '119.88' }
      )
    ).toEqual({
      selection: null,
      frameRate: '120'
    })
  })
})
