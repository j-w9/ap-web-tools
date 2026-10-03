import { useCallback, useEffect, useState } from 'react'
import { useLatest } from './useLatest.js'
import { readFileAsArrayBuffer } from './file.js'
import { onIncomingLog } from './open-in.js'

export interface LogFileState {
  /** The file chosen by the user or handed over by another tool; null for raw buffers. */
  file: File | null
  /** Call with the file from an `<input type="file">`. */
  openFile: (file: File) => void
}

/**
 * Wires log input for a tool: file picker selections and "Open in" hand-offs both end
 * up in `onBuffer`, which the tool uses to parse and display the log.
 */
export function useLogFile(onBuffer: (buffer: ArrayBuffer, name: string | null) => void | Promise<void>): LogFileState {
  const [file, setFile] = useState<File | null>(null)
  const handler = useLatest(onBuffer)

  const openFile = useCallback(
    (f: File) => {
      setFile(f)
      void readFileAsArrayBuffer(f).then((buffer) => handler.current(buffer, f.name))
    },
    [handler]
  )

  useEffect(
    () =>
      onIncomingLog((incoming) => {
        if (incoming.kind === 'file') openFile(incoming.file)
        else {
          setFile(null)
          void handler.current(incoming.buffer, null)
        }
      }),
    [openFile, handler]
  )

  return { file, openFile }
}
