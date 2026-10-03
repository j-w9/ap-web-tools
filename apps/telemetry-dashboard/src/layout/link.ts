/**
 * Shareable dashboard links (upstream `compress_layout`, `decompress_layout`,
 * `get_dashboard_link`): the layout JSON, raw-deflated and URL-safe base64 encoded, in the URL
 * hash with the connection settings.
 *
 *   https://.../TelemetryDashboard/#ws=ws%3A%2F%2F...&heartbeat=1&sysid=254&compid=190&signing=...&layout=...
 */

function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Response {
  const writer = stream.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  return new Response(stream.readable)
}

/** Deflates `json` and returns it as URL-safe base64 without padding. */
export async function compressLayout(json: string): Promise<string> {
  const response = pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  const compressed = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (const byte of compressed) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** Inverse of {@link compressLayout}. Rejects on malformed input. */
export async function decompressLayout(b64url: string): Promise<string> {
  const pad = b64url.length % 4
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + (pad !== 0 ? '='.repeat(4 - pad) : '')
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return pipe(bytes, new DecompressionStream('deflate-raw')).text()
}

/** Connection settings carried in a link (upstream `get_connection_params`). */
export interface LinkConnection {
  readonly ws: string
  readonly heartbeat: boolean
  readonly sysid: string
  readonly compid: string
  readonly signing: string
}

/** Builds the link: the page URL without query or hash, plus the hash parameters. */
export async function dashboardLink(pageUrl: string, connection: LinkConnection | null, layoutJson: string): Promise<string> {
  const url = new URL(pageUrl.split('?')[0]!.split('#')[0]!)
  const params = new URLSearchParams()
  if (connection !== null) {
    if (connection.ws !== '') params.set('ws', connection.ws)
    if (connection.heartbeat) {
      params.set('heartbeat', '1')
      params.set('sysid', connection.sysid)
      params.set('compid', connection.compid)
      if (connection.signing !== '') params.set('signing', connection.signing)
    }
  }
  params.set('layout', await compressLayout(layoutJson))
  url.hash = params.toString()
  return url.toString()
}

/** Settings read from the page's hash on load. */
export interface HashSettings {
  readonly layout: string | null
  readonly ws: string | null
  readonly heartbeat: boolean
  readonly sysid: string | null
  readonly compid: string | null
  readonly signing: string | null
}

export function readHash(hash: string): HashSettings {
  const params = new URLSearchParams(hash.slice(1))
  return {
    layout: params.get('layout'),
    ws: params.get('ws'),
    // Upstream tested the string's truthiness: `heartbeat=` (empty) is off.
    heartbeat: (params.get('heartbeat') ?? '') !== '',
    sysid: params.get('sysid'),
    compid: params.get('compid'),
    signing: params.get('signing')
  }
}
