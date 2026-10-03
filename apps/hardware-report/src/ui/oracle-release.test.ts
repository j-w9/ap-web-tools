// Oracle: upstream `check_release()` (run in a vm with a stubbed Octokit `request`) against the
// port's ReleaseChecker answering the same GitHub responses through `fetch`. The upstream paragraph
// text is rebuilt from the port's result in upstream's wording.
import { describe, expect, it } from 'vitest'
import { createUpstreamHardwareReport, type UpstreamHardwareReport } from '../test-utils/upstream.js'
import { ReleaseChecker, type Fetcher, type ReleaseCheck } from './release-check.js'

/** A GitHub API answer: data, or an HTTP error status (with an optional rate-limit reset). */
type Answer = { data: unknown } | { status: number; reset?: number }

interface Routes {
  tags?: Answer
  commit?: Answer
  branches?: Answer
}

const notFound: Answer = { status: 404 }

function portText(hash: string, check: ReleaseCheck): string {
  switch (check.kind) {
    case 'rate-limited':
      return ''
    case 'tags-failed':
      return `Version check failed to get whitelist (${hash})`
    case 'release':
      return 'Official release:' + check.tags.join(', ')
    case 'not-release': {
      let out = 'Warning: not official firmware release.'
      const c = check.commit
      if (c.kind === 'failed') return out + `Version check failed to get commit (${hash})`
      out += 'Found commit: ' + hash
      if (c.branches === 'failed') return out + 'Version check failed to get branches.'
      if (c.branches.length > 0) out += 'Branches @ HEAD: ' + c.branches.join(', ')
      return out
    }
  }
}

/** Upstream Octokit stub: resolves `{ data }` or throws `{ status, response: { headers } }`. */
function octokit(routes: Routes): (route: string) => Promise<{ data: unknown }> {
  return (route) => {
    const answer =
      (route.endsWith('/git/refs/tags')
        ? routes.tags
        : route.endsWith('branches-where-head')
          ? routes.branches
          : routes.commit) ?? notFound
    if ('data' in answer) return Promise.resolve({ data: answer.data })
    return Promise.reject(
      Object.assign(new Error('http'), {
        status: answer.status,
        response: { headers: { 'x-ratelimit-reset': answer.reset === undefined ? undefined : String(answer.reset) } }
      })
    )
  }
}

function fetcher(routes: Routes): Fetcher {
  return (url) => {
    const answer =
      (url.endsWith('/git/refs/tags') ? routes.tags : url.endsWith('branches-where-head') ? routes.branches : routes.commit) ??
      notFound
    if ('data' in answer) return Promise.resolve(new Response(JSON.stringify(answer.data)))
    const headers: Record<string, string> = answer.reset === undefined ? {} : { 'x-ratelimit-reset': String(answer.reset) }
    return Promise.resolve(new Response('{}', { status: answer.status, headers }))
  }
}

async function upstreamCheck(up: UpstreamHardwareReport, hash: string): Promise<string> {
  const p = up.dom.createElement('p')
  await up.call('check_release_original', hash, p)
  return p.textContent
}

const TAGS = [
  { ref: 'refs/tags/Copter-4.6.3', object: { sha: '92b0cd78aaaa' } },
  { ref: 'refs/tags/ArduCopter-stable', object: { sha: '92b0cd78aaaa' } },
  { ref: 'refs/tags/Plane-4.5.0', object: { sha: '11112222' } }
]

describe('oracle: check_release', () => {
  const cases: [string, Routes, string][] = [
    ['release tags', { tags: { data: TAGS } }, '92b0cd78'],
    [
      'commit with branches',
      {
        tags: { data: TAGS },
        commit: { data: { sha: 'full', html_url: 'u' } },
        branches: { data: [{ name: 'master' }, { name: 'x' }] }
      },
      'c664ff23'
    ],
    [
      'commit heading no branch',
      { tags: { data: TAGS }, commit: { data: { sha: 'full', html_url: 'u' } }, branches: { data: [] } },
      'c664ff23'
    ],
    ['unknown commit', { tags: { data: TAGS } }, 'deadbeef'],
    [
      'branch lookup failure',
      { tags: { data: TAGS }, commit: { data: { sha: 'full', html_url: 'u' } }, branches: { status: 500 } },
      'c664ff23'
    ],
    ['tag list failure', { tags: { status: 500 } }, '92b0cd78']
  ]
  it.each(cases)('%s', async (_, routes, hash) => {
    const up = await createUpstreamHardwareReport()
    up.call('((f) => { octokitRequest = f })', octokit(routes))
    const port = new ReleaseChecker(fetcher(routes))
    expect(portText(hash, await port.check(hash))).toBe(await upstreamCheck(up, hash))
  })

  it('stays quiet while rate limited', async () => {
    const routes: Routes = { tags: { status: 403, reset: Math.floor(Date.now() / 1000) + 1000 } }
    const up = await createUpstreamHardwareReport()
    up.call('((f) => { octokitRequest = f })', octokit(routes))
    const port = new ReleaseChecker(fetcher(routes))
    for (let i = 0; i < 2; i++)
      expect(portText('92b0cd78', await port.check('92b0cd78'))).toBe(await upstreamCheck(up, '92b0cd78'))
  })
})
