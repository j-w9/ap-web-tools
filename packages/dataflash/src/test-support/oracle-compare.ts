/**
 * Comparisons between the port and the upstream JsDataflashParser, shared by the oracle tests on
 * committed fixtures and the gated real-log tests. Tests only.
 */
import { expect } from 'vitest'
import type { Column } from '../decode.js'
import type { DataflashLog } from '../log.js'
import { upstreamFiles, type UpstreamParser } from './upstream-parser.js'

/** `stats()`: every defined type, in id order, zero counts included. */
export function expectSameStats(log: DataflashLog, up: UpstreamParser): void {
  const theirs = Object.entries(up.stats()).map(([name, s]) => [name, s.count, s.msg_size, s.size])
  const mine = [...log.stats()].map(([name, s]) => [name, s.count, s.recordSize, s.bytes])
  expect(mine).toEqual(theirs)
}

/**
 * Embedded files. Where upstream's FILE records hold one copy per file and every chunk's `Data`
 * keeps all `Length` bytes, the port's files are upstream's bytes exactly. Otherwise (a file
 * written twice, or chunks ending in zero bytes) upstream's `processFiles()` is wrong (proven
 * upstream bug, docs/bug-proofs/js-dataflash-parser.md): the port's file is then upstream's own
 * decoded records placed at `Offset`, `Length` bytes each (the stripped bytes are the trailing
 * NULs), keeping the last copy.
 */
export function expectSameFiles(log: DataflashLog, up: UpstreamParser): void {
  const theirs = upstreamFiles(up)
  const mine = log.files()
  expect([...mine.keys()]).toEqual(Object.keys(theirs))
  const file = up.messages['FILE'] as Record<string, ArrayLike<unknown>> | undefined
  for (const [name, data] of Object.entries(theirs)) {
    const records: { at: number; length: number; data: string }[] = []
    for (let i = 0; i < (file?.['FileName']?.length ?? 0); i++) {
      if (file?.['FileName']?.[i] !== name) continue
      records.push({ at: file['Offset']![i] as number, length: file['Length']![i] as number, data: file['Data']![i] as string })
    }
    const copies = records.filter((r) => r.at === 0).length
    const intact = records.every((r) => r.data.length === r.length)
    if (copies <= 1 && intact) {
      expect(Array.from(mine.get(name) ?? []), name).toEqual(Array.from(data))
      continue
    }
    const last = records.slice(records.map((r) => r.at).lastIndexOf(0))
    const expected = new Uint8Array(Math.max(...last.map((r) => r.at + r.length)))
    for (const r of last) {
      for (let j = 0; j < r.length; j++) expected[r.at + j] = j < r.data.length ? r.data.charCodeAt(j) : 0
    }
    expect(Array.from(mine.get(name) ?? []), name).toEqual(Array.from(expected))
    expect(Array.from(mine.get(name) ?? []), `${name} differs from upstream`).not.toEqual(Array.from(data))
  }
}

/** Message types, record counts, instances, field units and multipliers. */
export function expectSameTypes(log: DataflashLog, up: UpstreamParser): void {
  const names = Object.keys(up.messageTypes).filter((n) => !n.includes('['))
  expect([...log.messageTypes().keys()].sort()).toEqual([...names].sort())
  for (const name of names) {
    const theirs = up.messageTypes[name]!
    const info = log.messageType(name)!
    expect(info.count, name).toBe(log.count(name))
    expect([...info.fieldNames], `${name} fields`).toEqual(theirs.expressions)
    const instances = theirs.instances === undefined ? [] : Object.keys(theirs.instances).map(Number)
    expect([...log.instances(name)], `${name} instances`).toEqual(instances)
    for (const field of info.fields) {
      const complex = theirs.complexFields[field.name]!
      // Upstream gives `undefined` for ids missing from its tables; the port gives '?' and 1.
      if (complex.multiplier !== undefined && !complex.units.includes('undefined')) {
        // Upstream labels 1e-6 with `n`; the port uses the SI prefix `µ` (proven upstream bug,
        // docs/bug-proofs/js-dataflash-parser.md). Every other label is identical.
        const units = complex.multiplier === 1e-6 && complex.units.startsWith('n') ? 'µ' + complex.units.slice(1) : complex.units
        expect(field.unit, `${name}.${field.name} unit`).toBe(units)
        expect(field.multiplier, `${name}.${field.name} multiplier`).toBe(complex.multiplier)
      }
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  // Upstream decodes `a` (int16[32]) as a plain array; the port as an Int16Array.
  if (a instanceof Int16Array && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  }
  return false
}

/**
 * One decoded column against upstream's array for the same field: same length and every element
 * the same value (`Object.is`, so NaN equals NaN and -0 differs from 0). Fails at the first
 * mismatch with its index.
 */
export function expectColumnEqual(mine: Column | undefined, theirs: unknown, label: string): void {
  expect(mine, label).toBeDefined()
  expect(theirs, label).toBeDefined()
  if (mine === undefined || theirs === undefined) return
  const other = theirs as ArrayLike<unknown>
  expect(mine.length, `${label} length`).toBe(other.length)
  for (let i = 0; i < mine.length; i++) {
    const a: unknown = mine[i]
    const b = other[i]
    if (!sameValue(a, b)) {
      expect(a instanceof Int16Array ? Array.from(a) : a, `${label}[${i}]`).toEqual(b)
      expect.fail(`${label}[${i}]: ${String(a)} differs from ${String(b)}`)
    }
  }
}
