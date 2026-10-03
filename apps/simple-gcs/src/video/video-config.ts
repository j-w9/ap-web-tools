/**
 * Video endpoint settings (upstream `SimpleGCS/video.js`, `VideoPanel` constructor, URL builders
 * and `openSettings`). MediaMTX serves HLS on port 8888 and WebRTC on 8889.
 */
import type { KeyValueStore } from '../link/storage.js'
import type { WebRtcOptions } from './webrtc-player.js'

export interface VideoConfig {
  readonly host: string
  readonly path: string
  readonly user: string
  readonly pass: string
  readonly scheme: 'http' | 'https'
  readonly hlsPort: number
  readonly wrtcPort: number
}

const KEYS = { host: 'video.host', path: 'video.path', user: 'video.user', pass: 'video.pass' } as const

/** Saved settings, else the page's host and `stream`. */
export function loadVideoConfig(
  store: KeyValueStore,
  location: { readonly hostname: string; readonly protocol: string }
): VideoConfig {
  return {
    host: store.get(KEYS.host) || location.hostname || '127.0.0.1',
    path: store.get(KEYS.path) || 'stream',
    user: store.get(KEYS.user) || '',
    pass: store.get(KEYS.pass) || '',
    scheme: location.protocol === 'https:' ? 'https' : 'http',
    hlsPort: 8888,
    wrtcPort: 8889
  }
}

export const hlsUrl = (c: VideoConfig): string => `${c.scheme}://${c.host}:${c.hlsPort}/${c.path}/index.m3u8`
export const webrtcUrl = (c: VideoConfig): string => `${c.scheme}://${c.host}:${c.wrtcPort}/${c.path}/`
export const webRtcOptions = (c: VideoConfig): WebRtcOptions => ({ url: webrtcUrl(c) + 'whep', user: c.user, pass: c.pass })

/** The four settings prompts' answers; null for a cancelled prompt. */
export interface VideoSettingsAnswers {
  readonly host: string | null
  readonly path: string | null
  readonly user: string | null
  readonly pass: string | null
}

/**
 * Applies the settings answers as upstream does: any cancel, or a blank host or path, leaves the
 * saved configuration intact. Returns the new configuration, or null when nothing changed.
 */
export function applyVideoSettings(config: VideoConfig, answers: VideoSettingsAnswers, store: KeyValueStore): VideoConfig | null {
  const { host, path, user, pass } = answers
  if (host === null || path === null || user === null || pass === null) return null
  if (!host.trim() || !path.trim()) return null
  store.set(KEYS.host, host)
  store.set(KEYS.path, path)
  store.set(KEYS.user, user)
  store.set(KEYS.pass, pass)
  return { ...config, host, path, user, pass }
}

/** How HLS will be played (upstream `_playStableHLS`). */
export type HlsPlayback = 'webrtc-fallback' | 'native' | 'hlsjs'

export function chooseHlsPlayback(input: {
  readonly pageIsHttps: boolean
  readonly url: string
  readonly hasAuth: boolean
  readonly canPlayNative: boolean
  readonly hlsJsSupported: boolean
}): HlsPlayback {
  if (input.pageIsHttps && input.url.startsWith('http://')) return 'webrtc-fallback'
  // Native HLS cannot attach Authorization headers: protected streams use Hls.js, or WebRTC.
  if (!input.hasAuth && input.canPlayNative) return 'native'
  if (!input.hlsJsSupported) return 'webrtc-fallback'
  return 'hlsjs'
}

/** Basic auth header for Hls.js requests, or null without a user. */
export const hlsAuthHeader = (c: VideoConfig): string | null => (c.user ? 'Basic ' + btoa(`${c.user}:${c.pass}`) : null)

export const MAX_HLS_RETRIES = 3
