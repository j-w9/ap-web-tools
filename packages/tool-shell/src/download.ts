/**
 * Offer data to the user as a file download through a temporary object URL (replaces upstream's
 * FileSaver `saveAs`). The anchor is attached while it is clicked, which older Firefox needs, and
 * the URL is revoked shortly afterwards, once the browser has started the download.
 */
function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Download `text` as a UTF-8 text file named `fileName`. */
export function downloadText(fileName: string, text: string): void {
  downloadBlob(fileName, new Blob([text], { type: 'text/plain;charset=utf-8' }))
}

/** Download `bytes` as a file named `fileName`, with an optional media type. */
export function downloadBytes(fileName: string, bytes: Uint8Array, type?: string): void {
  // Copy so the Blob owns a plain ArrayBuffer and later changes to `bytes` do not leak into it.
  downloadBlob(fileName, new Blob([bytes.slice()], type === undefined ? {} : { type }))
}
