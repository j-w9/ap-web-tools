import { useEffect, useRef, type InputHTMLAttributes } from 'react'
import { useLatest } from '@apwt/tool-shell'

export interface CommitNumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> {
  /** The value to show; written into the input whenever it changes. */
  value: string
  /** Called with the input's text on the native `change` event (commit: Enter, blur or a spinner click). */
  onCommit: (raw: string) => void
}

/**
 * A number input that reports only committed values, like upstream's `onchange=` handlers.
 * React's `onChange` fires on every keystroke, which would act on half-typed values.
 */
export function CommitNumberInput({ value, onCommit, ...rest }: CommitNumberInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const commit = useLatest(onCommit)

  useEffect(() => {
    const el = ref.current
    if (el && el.value !== value) el.value = value
  }, [value])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => commit.current(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [commit])

  return <input ref={ref} type="number" defaultValue={value} {...rest} />
}
