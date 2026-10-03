import { useEffect, useRef } from 'react'

/**
 * A ref that always holds the latest `value`, for callbacks that must not re-run effects
 * when their identity changes. Updated after render, so read it only in effects and events.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
