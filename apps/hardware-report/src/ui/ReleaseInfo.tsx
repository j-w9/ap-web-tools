import { useEffect, useState } from 'react'
import { Badge } from './common.js'
import { ReleaseChecker, treeUrl, type ReleaseCheck } from './release-check.js'

const checker = new ReleaseChecker((url, init) => fetch(url, init))

/** Release status of a firmware hash, fetched from GitHub; failures are shown quietly. */
export function ReleaseInfo({ hash }: { hash: string }) {
  const [result, setResult] = useState<{ hash: string; check: ReleaseCheck } | null>(null)
  useEffect(() => {
    let live = true
    void checker.check(hash).then((check) => {
      if (live) setResult({ hash, check })
    })
    return () => {
      live = false
    }
  }, [hash])

  const check = result?.hash === hash ? result.check : null
  if (check === null) return <span className="apwt-section__help">Checking release…</span>
  switch (check.kind) {
    case 'release':
      return (
        <span>
          <Badge tone="good">Official release</Badge>{' '}
          {check.tags.map((t, i) => (
            <span key={t}>
              {i > 0 && ', '}
              <a href={treeUrl(t)}>{t}</a>
            </span>
          ))}
        </span>
      )
    case 'commit':
      return (
        <span>
          <Badge tone="neutral">Not a release</Badge> <a href={check.url}>commit {hash}</a>
          {check.branches.length > 0 && (
            <>
              {' '}
              (head of{' '}
              {check.branches.map((b, i) => (
                <span key={b}>
                  {i > 0 && ', '}
                  <a href={treeUrl(b)}>{b}</a>
                </span>
              ))}
              )
            </>
          )}
        </span>
      )
    case 'unofficial':
      return <Badge tone="bad">Not official firmware</Badge>
    case 'unavailable':
      return <span className="apwt-section__help">Release check unavailable ({check.reason})</span>
  }
}
