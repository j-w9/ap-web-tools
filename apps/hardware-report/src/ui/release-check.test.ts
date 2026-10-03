import { describe, expect, it } from 'vitest'
import { ReleaseChecker, type Fetcher } from './release-check.js'

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

const TAGS = [
  { ref: 'refs/tags/Copter-4.6.3', object: { sha: '92b0cd78aaaa' } },
  { ref: 'refs/tags/ArduCopter-stable', object: { sha: '92b0cd78aaaa' } },
  { ref: 'refs/tags/Plane-4.5.0', object: { sha: '11112222' } }
]

function fakeFetch(routes: Record<string, () => Response | Promise<Response>>, calls: string[] = []): Fetcher {
  return (url) => {
    const path = url.replace('https://api.github.com/repos/ArduPilot/ardupilot', '')
    calls.push(path)
    const route = routes[path]
    return Promise.resolve(route ? route() : json({ message: 'Not Found' }, 404))
  }
}

describe('ReleaseChecker', () => {
  it('finds release tags and downloads them once', async () => {
    const calls: string[] = []
    const checker = new ReleaseChecker(fakeFetch({ '/git/refs/tags': () => json(TAGS) }, calls))
    expect(await checker.check('92b0cd78')).toEqual({ kind: 'release', tags: ['Copter-4.6.3', 'ArduCopter-stable'] })
    expect(await checker.check('11112222')).toEqual({ kind: 'release', tags: ['Plane-4.5.0'] })
    expect(calls).toEqual(['/git/refs/tags'])
  })

  it('reports dev commits with the branches they head', async () => {
    const checker = new ReleaseChecker(
      fakeFetch({
        '/git/refs/tags': () => json(TAGS),
        '/commits/c664ff23': () =>
          json({ sha: 'c664ff23full', html_url: 'https://github.com/ArduPilot/ardupilot/commit/c664ff23full' }),
        '/commits/c664ff23full/branches-where-head': () => json([{ name: 'master' }])
      })
    )
    expect(await checker.check('c664ff23')).toEqual({
      kind: 'commit',
      url: 'https://github.com/ArduPilot/ardupilot/commit/c664ff23full',
      branches: ['master']
    })
  })

  it('flags hashes unknown to ArduPilot', async () => {
    const checker = new ReleaseChecker(fakeFetch({ '/git/refs/tags': () => json(TAGS) }))
    expect(await checker.check('deadbeef')).toEqual({ kind: 'unofficial' })
  })

  it('fails quietly offline and backs off when rate limited', async () => {
    const offline = new ReleaseChecker(() => Promise.reject(new Error('offline')))
    expect((await offline.check('92b0cd78')).kind).toBe('unavailable')

    const calls: string[] = []
    let now = 1000
    const limited = new ReleaseChecker(
      fakeFetch({ '/git/refs/tags': () => json({ message: 'rate limit' }, 403, { 'x-ratelimit-reset': '1060' }) }, calls),
      () => now
    )
    expect(await limited.check('92b0cd78')).toEqual({ kind: 'unavailable', reason: 'could not get release tags' })
    await limited.check('92b0cd78')
    expect(calls).toHaveLength(1) // second call suppressed until the reset time
    now = 1061
    await limited.check('92b0cd78')
    expect(calls).toHaveLength(2)
  })
})
