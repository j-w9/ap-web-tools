/**
 * Where logs come from: a directory handle (File System Access API), a file input (folder or
 * files) or a drag and drop. Each source can be listed again for "Reload".
 */
import type { LogFileRef } from '../analysis/scan.js'
import { isLogFileName } from '../analysis/scan.js'

/** A log file with its path below the chosen folder. */
export interface PickedFile {
  readonly file: File
  readonly relativePath: string
}

/** A chosen set of logs, kept so it can be scanned again. */
export type LogSource =
  | { readonly kind: 'directory'; readonly handle: FileSystemDirectoryHandle }
  | { readonly kind: 'dropped'; readonly label: string; readonly entries: readonly FileSystemEntry[] }
  | { readonly kind: 'files'; readonly label: string; readonly files: readonly PickedFile[] }

/** Name shown for a source in the page title and rail. */
export function sourceLabel(source: LogSource): string {
  switch (source.kind) {
    case 'directory':
      return source.handle.name + '/'
    case 'dropped':
    case 'files':
      return source.label
  }
}

/** Whether the browser can open a directory handle (and so reload new files from it). */
export function canPickDirectory(): boolean {
  return typeof window.showDirectoryPicker === 'function'
}

/** Ask the user for a directory; `null` if they cancel. */
export async function pickDirectory(): Promise<LogSource | null> {
  if (window.showDirectoryPicker === undefined) return null
  try {
    return { kind: 'directory', handle: await window.showDirectoryPicker({ mode: 'read' }) }
  } catch {
    return null
  }
}

async function* walkHandle(handle: FileSystemDirectoryHandle, path: string): AsyncGenerator<PickedFile> {
  for await (const entry of handle.values()) {
    const relativePath = `${path}/${entry.name}`
    // Upstream skips any entry (file or directory) that fails to open.
    try {
      if (entry.kind === 'file') {
        const file = await entry.getFile()
        if (isLogFileName(file.name)) yield { file, relativePath }
      } else {
        yield* walkHandle(entry, relativePath)
      }
    } catch {
      continue
    }
  }
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory
}

async function walkEntry(entry: FileSystemEntry, out: PickedFile[]): Promise<void> {
  const relativePath = entry.fullPath.replace(/^\//, '')
  if (isFileEntry(entry)) {
    if (isLogFileName(entry.name)) out.push({ file: await entryFile(entry), relativePath })
    return
  }
  if (!isDirectoryEntry(entry)) return
  const reader = entry.createReader()
  // readEntries returns the directory in batches; an empty batch means done.
  for (let batch = await readEntries(reader); batch.length > 0; batch = await readEntries(reader)) {
    for (const child of batch) {
      try {
        await walkEntry(child, out)
      } catch {
        // Skip unreadable folders, as upstream.
      }
    }
  }
}

/** Every `.bin` file in a source, in directory order. */
export async function listSource(source: LogSource): Promise<PickedFile[]> {
  switch (source.kind) {
    case 'directory': {
      const out: PickedFile[] = []
      for await (const f of walkHandle(source.handle, source.handle.name)) out.push(f)
      return out
    }
    case 'dropped': {
      const out: PickedFile[] = []
      for (const entry of source.entries) await walkEntry(entry, out)
      return out
    }
    case 'files':
      return [...source.files]
  }
}

/** Source from an `<input type="file">` selection (a folder with `webkitdirectory`, or files). */
export function sourceFromInput(list: FileList): LogSource | null {
  const files = [...list]
    .map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }))
    .filter((f) => isLogFileName(f.file.name))
  if (list.length === 0) return null
  const first = list[0]?.webkitRelativePath.split('/')[0]
  const label = first ? `${first}/` : list.length === 1 ? (list[0]?.name ?? '') : `${list.length} files`
  return { kind: 'files', label, files }
}

/**
 * Source from a drop. Entries must be taken while the drop event is being handled, so call this
 * synchronously from `onDrop`.
 */
export function sourceFromDrop(transfer: DataTransfer): LogSource | null {
  const entries = [...transfer.items].flatMap((item) => {
    const entry = item.kind === 'file' ? item.webkitGetAsEntry() : null
    return entry === null ? [] : [entry]
  })
  if (entries.length > 0) {
    const label =
      entries.length === 1 && entries[0] ? entries[0].name + (entries[0].isDirectory ? '/' : '') : `${entries.length} items`
    return { kind: 'dropped', label, entries }
  }
  return transfer.files.length > 0 ? sourceFromInput(transfer.files) : null
}

/** Adapt picked files to the scanner's file references. */
export function toLogFileRefs(files: readonly PickedFile[]): LogFileRef<File>[] {
  return files.map(({ file, relativePath }) => ({ relativePath, name: file.name, file, read: () => file.arrayBuffer() }))
}
