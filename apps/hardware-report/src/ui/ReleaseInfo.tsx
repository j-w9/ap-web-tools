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
  return <ReleaseResult hash={hash} check={check} />
}

function Links({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          <a href={treeUrl(n)}>{n}</a>
        </span>
      ))}
    </>
  )
}

/** The upstream `check_release` text for each outcome. */
function ReleaseResult({ hash, check }: { hash: string; check: ReleaseCheck }) {
  switch (check.kind) {
    case 'rate-limited':
      return null
    case 'tags-failed':
      return <span className="apwt-section__help">Version check failed to get whitelist ({hash})</span>
    case 'release':
      return (
        <span>
          <Badge tone="good">Official release:</Badge> <Links names={check.tags} />
        </span>
      )
    case 'not-release': {
      const c = check.commit
      return (
        <span>
          <Badge tone="bad">Warning: not official firmware release.</Badge>{' '}
          {c.kind === 'failed' ? (
            <>Version check failed to get commit ({hash})</>
          ) : (
            <>
              Found commit: <a href={c.url}>{hash}</a>
              {c.branches === 'failed' ? (
                <> Version check failed to get branches.</>
              ) : (
                c.branches.length > 0 && (
                  <>
                    {' '}
                    Branches @ HEAD: <Links names={c.branches} />
                  </>
                )
              )}
            </>
          )}
        </span>
      )
    }
  }
}
