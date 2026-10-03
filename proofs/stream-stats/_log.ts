import { LogWriter } from '@apwt/dataflash/testing'

/** FMT + ten IMU records (13-byte body, 16 bytes with header), one per second from 0 to 9 s. */
export function tenImuRecords(): Uint8Array {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(30, 'IMU', 'QBf', 'TimeUS,I,T')
  for (let i = 0; i < 10; i++) w.write('IMU', [i * 1e6, 0, 20])
  return w.toBytes()
}
