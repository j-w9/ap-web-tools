/**
 * Row: "Unknown type code ends the scan" (`parser.js` `DfReader`, `get_size_of`).
 */
import { LogWriter } from '@apwt/dataflash/testing'
import { describe, expect, it } from 'vitest'
import { upstreamParse } from './_harness.js'

describe('JsDataflashParser DfReader', () => {
  it('sizes a format with an unknown type code as NaN and stops at its first record', async () => {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(30, 'IMU', 'QBf', 'TimeUS,I,T')
    // FMT for id 40 with the type code 'x', which get_size_of does not know.
    w.raw([0xa3, 0x95, 0x80, ...LogWriter.encodeBody('BBnNZ', [40, 0, 'BAD', 'Qx', 'TimeUS,X'])])
    w.write('IMU', [1, 0, 20])
    w.raw([0xa3, 0x95, 40, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    w.write('IMU', [2, 0, 21])
    w.write('IMU', [3, 0, 22])
    const { parser } = await upstreamParse(w.toBytes())

    expect(parser.FMT[40]!.Size).toBeNaN()
    expect(parser.offset).toBeNaN()
    // Only the IMU record before the BAD record is found; the two after it are lost.
    expect(parser.stats()['IMU']).toEqual({ count: 1, msg_size: 16, size: 16 })
  })
})
