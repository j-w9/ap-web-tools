// File System Access API members used by the folder picker that TypeScript's DOM library does
// not declare yet (Chromium only; feature-detected before use).
interface ShowDirectoryPickerOptions {
  mode?: 'read' | 'readwrite'
}

interface Window {
  showDirectoryPicker?: (options?: ShowDirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
}
