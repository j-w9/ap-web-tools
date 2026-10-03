/**
 * Parameter model over MAVFTP (upstream `modules/MAVLink/mavparam.js`, class `MAVParam`): fetch
 * values with defaults, search, and apply changes with a verifying read-back.
 */
import type { FtpCallback } from '../ftp/client.js'
import type { GetFileOptions, PutFileOptions } from '../ftp/manager.js'
import { jsonText, type ParamDefinition } from './definitions.js'
import { decodeParams, encodeUpload, PARAM_DOWNLOAD, PARAM_UPLOAD, valueForType, type Param } from './packed.js'

/** The FTP operations the model needs (implemented by `FtpManager`). */
export interface ParamFtpPort {
  getFile(path: string, callback: FtpCallback<Uint8Array>, options?: GetFileOptions): void
  putFile(path: string, data: Uint8Array, callback: FtpCallback<number>, options?: PutFileOptions): void
}

/** A requested change: the parameter with its new value, and the value it replaces. */
export interface ParamChange extends Param {
  readonly previousValue: number
}

export class MavParam {
  params = new Map<string, Param>()
  definitions: ReadonlyMap<string, ParamDefinition> = new Map()
  connected = true
  busy = false
  private generation = 0
  private readonly listeners = new Set<(model: MavParam) => void>()

  constructor(private readonly ftp: ParamFtpPort) {}

  subscribe(callback: (model: MavParam) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this)
  }

  /** The vehicle went away: invalidate values and in-flight operations. */
  disconnect(): void {
    this.connected = false
    this.generation++
    this.params.clear()
    this.emit()
  }

  setDefinitions(definitions: ReadonlyMap<string, ParamDefinition>): void {
    this.definitions = definitions
    this.emit()
  }

  private async transaction<T>(fn: (check: () => void) => Promise<T>): Promise<T> {
    if (!this.connected) throw new Error('Vehicle disconnected')
    if (this.busy) throw new Error('A parameter operation is already in progress')
    this.busy = true
    this.emit()
    const generation = this.generation
    try {
      return await fn(() => {
        if (!this.connected || generation !== this.generation) throw new Error('Vehicle disconnected')
      })
    } finally {
      this.busy = false
      this.emit()
    }
  }

  private async download(check: () => void): Promise<Map<string, Param>> {
    const outcome = await new Promise<Parameters<FtpCallback<Uint8Array>>[0]>((resolve) =>
      this.ftp.getFile(PARAM_DOWNLOAD, resolve, { timeoutMs: 20000, sizeIsEstimate: true, fixedReadSize: true })
    )
    check()
    if (outcome.kind === 'failed') throw new Error('Parameter download failed')
    const params = decodeParams(outcome.value)
    this.params = params
    return params
  }

  refresh(): Promise<Map<string, Param>> {
    return this.transaction((check) => this.download(check))
  }

  /** Values that differ from the current ones; throws for unknown, invalid or read-only parameters. */
  changes(values: ReadonlyMap<string, number>): ParamChange[] {
    if (!this.params.size) throw new Error('Fetch parameters first')
    const changes: ParamChange[] = []
    for (const [name, raw] of values) {
      const p = this.params.get(name)
      if (p === undefined) throw new Error(`Unknown parameter: ${name}`)
      const value = valueForType(raw, p.type)
      if (value === p.value) continue
      if (this.definitions.get(name)?.readOnly === true) throw new Error(`${name} is read-only`)
      changes.push({ ...p, value, previousValue: p.value })
    }
    return changes
  }

  apply(values: ReadonlyMap<string, number>): Promise<ParamChange[]> {
    return this.transaction(async (check) => {
      const changes = this.changes(values)
      if (!changes.length) return []
      const bytes = encodeUpload(changes)
      const sent = await new Promise<Parameters<FtpCallback<number>>[0]>((resolve) =>
        this.ftp.putFile(PARAM_UPLOAD, bytes, resolve, { timeoutMs: 20000 })
      )
      check()
      // Even a failed upload can have applied a prefix on file close. Refresh rather than
      // displaying optimistic cached values.
      try {
        await this.download(check)
      } catch (e) {
        this.params.clear()
        throw new Error(`Upload outcome unverified: ${errorMessage(e)}. Fetch parameters again.`)
      }
      if (sent.kind === 'failed')
        throw new Error('Upload failed or close was not acknowledged; current values have been refreshed')
      const rejected = changes.filter((p) => this.params.get(p.name)?.value !== p.value)
      if (rejected.length) throw new Error(`Vehicle did not retain requested values: ${rejected.map((p) => p.name).join(', ')}`)
      return changes
    })
  }

  reset(name: string): Promise<ParamChange[]> {
    const p = this.params.get(name)
    if (p?.defaultValue === undefined) return Promise.reject(new Error('Default unavailable'))
    return this.apply(new Map([[name, p.defaultValue]]))
  }

  /** Parameters whose name, label and description contain every search term, sorted by name. */
  search(query = '', nonDefault = false): Param[] {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return [...this.params.values()]
      .filter((p) => {
        if (nonDefault && (p.defaultValue === undefined || p.value === p.defaultValue)) return false
        const d = this.definitions.get(p.name)
        const text = `${p.name} ${jsonText(d?.label || '')} ${jsonText(d?.description || '')}`.toLowerCase()
        return terms.every((term) => text.includes(term))
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
