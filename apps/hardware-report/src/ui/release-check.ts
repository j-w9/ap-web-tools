/**
 * Check a firmware git hash against the ArduPilot GitHub repository (upstream `check_release`):
 * first the release tags, then the commit itself and the branches it heads. Uses the REST
 * endpoints upstream reaches through Octokit, with the same outcomes: every step that upstream
 * reports, including each failure, is a distinct result, and nothing is thrown.
 */

const API = 'https://api.github.com/repos/ArduPilot/ardupilot'
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } as const

/** What upstream found for the commit of a hash that is not a release. */
export type CommitCheck =
  /** "Version check failed to get commit (hash)". */
  | { readonly kind: 'failed' }
  /** "Found commit: hash", then the branches it heads, or "Version check failed to get branches." */
  | { readonly kind: 'found'; readonly url: string; readonly branches: readonly string[] | 'failed' }

/** Outcome of a release check, one variant per upstream outcome. */
export type ReleaseCheck =
  /** Upstream returns without output while a GitHub rate limit is in force. */
  | { readonly kind: 'rate-limited' }
  /** "Version check failed to get whitelist (hash)". */
  | { readonly kind: 'tags-failed' }
  /** "Official release:" and the matching tags. */
  | { readonly kind: 'release'; readonly tags: readonly string[] }
  /** "Warning: not official firmware release." and what was found for the commit. */
  | { readonly kind: 'not-release'; readonly commit: CommitCheck }

/** Minimal `fetch` signature, injectable for tests. */
export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Response>

interface TagRef {
  ref: string
  object: { sha: string }
}

function isTagRef(x: unknown): x is TagRef {
  if (typeof x !== 'object' || x === null) return false
  const r = x as { ref?: unknown; object?: unknown }
  return (
    typeof r.ref === 'string' &&
    typeof r.object === 'object' &&
    r.object !== null &&
    typeof (r.object as { sha?: unknown }).sha === 'string'
  )
}

/** Release-check state shared by every check on the page (the tag list and the rate-limit reset). */
export class ReleaseChecker {
  private tags: readonly TagRef[] | undefined
  private rateLimitResetS: number | undefined

  constructor(
    private readonly fetcher: Fetcher,
    private readonly nowS: () => number = () => Date.now() / 1000
  ) {}

  /** One request; any failure (network, non-2xx, bad JSON) is `undefined`, as an Octokit throw upstream. */
  private async get(path: string): Promise<{ json: unknown } | undefined> {
    let res: Response
    try {
      res = await this.fetcher(API + path, { headers: { ...HEADERS } })
    } catch {
      return undefined
    }
    if (res.status === 403 || res.status === 429) {
      // Upstream `api_error`: `parseInt` of the header, so a missing header sets no usable reset.
      this.rateLimitResetS = parseInt(res.headers.get('x-ratelimit-reset') ?? '')
      return undefined
    }
    if (!res.ok) return undefined
    try {
      return { json: await res.json() }
    } catch {
      return undefined
    }
  }

  /** Check one hash (8 hex digits or longer). */
  async check(hash: string): Promise<ReleaseCheck> {
    if (this.rateLimitResetS !== undefined && !Number.isNaN(this.rateLimitResetS)) {
      if (this.nowS() < this.rateLimitResetS) return { kind: 'rate-limited' }
      this.rateLimitResetS = undefined
    }

    if (this.tags === undefined) {
      const r = await this.get('/git/refs/tags')
      if (r === undefined || !Array.isArray(r.json)) return { kind: 'tags-failed' }
      this.tags = r.json.filter(isTagRef)
    }
    const matching = this.tags.filter((t) => t.object.sha.startsWith(hash)).map((t) => t.ref.replace(/^(refs\/tags\/)/gm, ''))
    if (matching.length > 0) return { kind: 'release', tags: matching }

    // Dev builds from master have no tag, so they get the warning too.
    const commit = await this.get(`/commits/${hash}`)
    const data = commit?.json as { sha?: unknown; html_url?: unknown } | undefined
    if (data === undefined || typeof data.sha !== 'string' || typeof data.html_url !== 'string') {
      return { kind: 'not-release', commit: { kind: 'failed' } }
    }

    const heads = await this.get(`/commits/${data.sha}/branches-where-head`)
    const branches =
      heads !== undefined && Array.isArray(heads.json)
        ? heads.json
            .map((b: unknown) => (typeof b === 'object' && b !== null ? (b as { name?: unknown }).name : undefined))
            .filter((n): n is string => typeof n === 'string')
        : 'failed'
    return { kind: 'not-release', commit: { kind: 'found', url: data.html_url, branches } }
  }
}

/** Link to a tag or branch in the ArduPilot repository. */
export function treeUrl(name: string): string {
  return `https://github.com/ArduPilot/ardupilot/tree/${name}`
}
