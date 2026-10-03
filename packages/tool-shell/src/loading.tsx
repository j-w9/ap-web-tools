import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface LoadingContextValue {
  /** Show the overlay while `work` runs; the overlay is painted before `work` starts. */
  run: <T>(work: () => Promise<T> | T, label?: string) => Promise<T>
  busy: boolean
}

const LoadingContext = createContext<LoadingContextValue | null>(null)

/**
 * Wait two animation frames so the overlay is painted before heavy synchronous work. Hidden
 * tabs get no animation frames, so there the work starts on the next task instead.
 */
function nextPaint(): Promise<void> {
  if (document.hidden) return new Promise((resolve) => setTimeout(resolve, 0))
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/** Provides the busy overlay (a card with CustomBuild's shimmer bar) and `useLoading`. */
export function LoadingProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<string[]>([])

  const run = useCallback(async <T,>(work: () => Promise<T> | T, label = 'Working'): Promise<T> => {
    setLabels((l) => [...l, label])
    try {
      await nextPaint()
      return await work()
    } finally {
      setLabels((l) => l.slice(0, -1))
    }
  }, [])

  const value = useMemo(() => ({ run, busy: labels.length > 0 }), [run, labels.length])
  const label = labels[labels.length - 1]

  return (
    <LoadingContext.Provider value={value}>
      {children}
      {label && (
        <div className="apwt-loading" role="status" aria-live="polite">
          <div className="apwt-card apwt-loading__panel">
            <div className="apwt-loading__label">{label}…</div>
            <div className="apwt-progress" />
          </div>
        </div>
      )}
    </LoadingContext.Provider>
  )
}

/** Access the busy overlay: `const { run } = useLoading(); await run(() => work(), 'Reading log')`. */
export function useLoading(): LoadingContextValue {
  const ctx = useContext(LoadingContext)
  if (!ctx) throw new Error('useLoading must be used inside <LoadingProvider>')
  return ctx
}
