// Test-only: a fluent wrapper over the dataflash package's LogWriter that assigns message ids and
// marks instance fields, so tests can build exactly the messages they need.
import { DataflashLog } from '@apwt/dataflash'
import { LogWriter, type FieldValue } from '@apwt/dataflash/testing'

/** Fluent log builder that assigns message ids and writes FMTU records for instanced messages. */
export class SyntheticLog {
  private readonly w = new LogWriter()
  private nextId = 0x90

  constructor() {
    this.w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    this.w.defineFormat(0x81, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  }

  /**
   * Define a message. `instanceField` (a column name) is marked with the `#` unit so the parser
   * splits the message by instance.
   */
  define(name: string, format: string, columns: string, instanceField?: string): this {
    const id = this.nextId++
    this.w.defineFormat(id, name, format, columns)
    if (instanceField !== undefined) {
      const cols = columns.split(',')
      const units = cols.map((c) => (c === instanceField ? '#' : '-')).join('')
      this.w.write('FMTU', [0, id, units, '-'.repeat(cols.length)])
    }
    return this
  }

  /** Write one record of a defined message. */
  write(name: string, values: readonly FieldValue[]): this {
    this.w.write(name, values)
    return this
  }

  /** Write PARM records (Value and Default) at `timeUs`. */
  params(params: Readonly<Record<string, number>>, timeUs = 1000, defaults: Readonly<Record<string, number>> = {}): this {
    for (const [k, v] of Object.entries(params)) this.w.write('PARM', [timeUs, k, v, defaults[k] ?? NaN])
    return this
  }

  /** The log bytes. */
  bytes(): Uint8Array {
    return this.w.toBytes()
  }

  /** Parse the log. */
  parse(): DataflashLog {
    return DataflashLog.parse(this.bytes())
  }
}

/** A synthetic log with PARM (TimeUS,Name,Value,Default) and MSG already defined. */
export function baseLog(): SyntheticLog {
  return new SyntheticLog().define('PARM', 'QNff', 'TimeUS,Name,Value,Default').define('MSG', 'QZ', 'TimeUS,Message')
}
