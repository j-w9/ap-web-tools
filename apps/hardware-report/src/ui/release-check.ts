/**
 * Check a firmware git hash against the ArduPilot GitHub repository (upstream `check_release`):
 * first the release tags, then the commit itself and the branches it heads. Uses the same REST
 * endpoints upstream reaches through Octokit. Network errors and rate limits resolve to a quiet
 * `unavailable` result; nothing is thrown.
 */

const API = 'https://api.github.com/repos/ArduPilot/ardupilot'
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } as const

/** Outcome of a release check. */
export type ReleaseCheck =
  | { readonly kind: 'release'; readonly tags: readonly string[] }
  | { readonly kind: 'commit'; readonly url: string; readonly branches: readonly string[] }
  | { readonly kind: 'unofficial' }
  | { readonly kind: 'unavailable'; readonly reason: string }

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

/** Release-check state shared by every check on the page (one tag download, rate-limit backoff). */
export class ReleaseChecker {
  private tags: Promise<readonly TagRef[] | undefined> | undefined
  private rateLimitResetS: number | undefined

  constructor(
    private readonly fetcher: Fetcher,
    private readonly nowS: () => number = () => Date.now() / 1000
  ) {}

  private async get(path: string): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
    if (this.rateLimitResetS !== undefined) {
      if (this.nowS() < this.rateLimitResetS) return { ok: false, reason: 'GitHub rate limit reached' }
      this.rateLimitResetS = undefined
    }
    let res: Response
    try {
      res = await this.fetcher(API + path, { headers: { ...HEADERS } })
    } catch {
      return { ok: false, reason: 'offline' }
    }
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'))
      this.rateLimitResetS = Number.isFinite(reset) && reset > 0 ? reset : this.nowS() + 60
      return { ok: false, reason: 'GitHub rate limit reached' }
    }
    if (!res.ok) return { ok: false, reason: `GitHub returned ${res.status}` }
    try {
      return { ok: true, json: await res.json() }
    } catch {
      return { ok: false, reason: 'bad response' }
    }
  }

  private loadTags(): Promise<readonly TagRef[] | undefined> {
    this.tags ??= this.get('/git/refs/tags').then((r) => {
      if (!r.ok || !Array.isArray(r.json)) {
        this.tags = undefined // retry next time
        return undefined
      }
      return r.json.filter(isTagRef)
    })
    return this.tags
  }

  /** Check one hash (8 hex digits or longer). */
  async check(hash: string): Promise<ReleaseCheck> {
    const tags = await this.loadTags()
    if (tags === undefined) return { kind: 'unavailable', reason: 'could not get release tags' }
    const matching = tags.filter((t) => t.object.sha.startsWith(hash)).map((t) => t.ref.replace(/^refs\/tags\//, ''))
    if (matching.length > 0) return { kind: 'release', tags: matching }

    // Not a release; dev builds from master have no tag.
    const commit = await this.get(`/commits/${hash}`)
    if (!commit.ok)
      return commit.reason.startsWith('GitHub returned 4')
        ? { kind: 'unofficial' }
        : { kind: 'unavailable', reason: commit.reason }
    const data = commit.json as { sha?: unknown; html_url?: unknown }
    if (typeof data.sha !== 'string' || typeof data.html_url !== 'string') return { kind: 'unofficial' }

    const heads = await this.get(`/commits/${data.sha}/branches-where-head`)
    const branches =
      heads.ok && Array.isArray(heads.json)
        ? heads.json
            .map((b: unknown) => (typeof b === 'object' && b !== null ? (b as { name?: unknown }).name : undefined))
            .filter((n): n is string => typeof n === 'string')
        : []
    return { kind: 'commit', url: data.html_url, branches }
  }
}

/** Link to a tag or branch in the ArduPilot repository. */
export function treeUrl(name: string): string {
  return `https://github.com/ArduPilot/ardupilot/tree/${name}`
}
