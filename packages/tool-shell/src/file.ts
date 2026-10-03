/** Read a `File` into an `ArrayBuffer`. */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

/** True when a file name looks like a DataFlash log. */
export function isDataflashFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.bin')
}
