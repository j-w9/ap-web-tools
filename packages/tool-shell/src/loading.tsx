import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface LoadingContextValue {
  /** Show the overlay while `work` runs; the overlay is painted before `work` starts. */
  run: <T>(work: () => Promise<T> | T) => Promise<T>
  busy: boolean
}

const LoadingContext = createContext<LoadingContextValue | null>(null)

/** Wait two animation frames so the overlay is actually painted before heavy synchronous work. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/** Provides a full-page "Loading" overlay and the `useLoading` hook to drive it. */
export function LoadingProvider({ children }: { children: ReactNode }) {
  const [depth, setDepth] = useState(0)

  const run = useCallback(async <T,>(work: () => Promise<T> | T): Promise<T> => {
    setDepth((d) => d + 1)
    try {
      await nextPaint()
      return await work()
    } finally {
      setDepth((d) => d - 1)
    }
  }, [])

  const value = useMemo(() => ({ run, busy: depth > 0 }), [run, depth])

  return (
    <LoadingContext.Provider value={value}>
      {children}
      {depth > 0 && (
        <div className="apwt-loading" role="status" aria-live="polite">
          <h1>Loading</h1>
        </div>
      )}
    </LoadingContext.Provider>
  )
}

/** Access the loading overlay: `const { run } = useLoading(); await run(() => heavyWork())`. */
export function useLoading(): LoadingContextValue {
  const ctx = useContext(LoadingContext)
  if (!ctx) throw new Error('useLoading must be used inside <LoadingProvider>')
  return ctx
}
