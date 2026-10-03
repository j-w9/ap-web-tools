/**
 * Test-only: a small DataFlash log shaped like a Copter System ID flight. RATE carries a chirp
 * on every axis output, SIDD the rate and acceleration response of simple linear models, ATT
 * the attitude. ATT starts late and stops early so window edges and gravity compensation
 * exercise upstream's index arithmetic, including reads past the end of ATT.
 */
import { LogWriter } from '@apwt/dataflash/testing'

export interface SyntheticSidOptions {
  /** Seconds of data. */
  readonly duration?: number
  /** Sample rate of RATE and SIDD, Hz. */
  readonly rate?: number
}

const DEG = 180 / Math.PI

export function buildSyntheticSidLog(options: SyntheticSidOptions = {}): Uint8Array {
  const duration = options.duration ?? 20
  const rate = options.rate ?? 400
  const dt = 1 / rate
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0x81, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.defineFormat(0x82, 'UNIT', 'QbZ', 'TimeUS,Id,Label')
  w.defineFormat(0x83, 'MULT', 'Qbd', 'TimeUS,Id,Mult')
  w.defineFormat(0x84, 'MSG', 'QZ', 'TimeUS,Message')
  w.defineFormat(0x85, 'MODE', 'QMBB', 'TimeUS,Mode,ModeNum,Rsn')
  w.defineFormat(0x86, 'ATT', 'QccccCCCC', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw,ErrRP,ErrYaw')
  w.defineFormat(0x87, 'RATE', 'Qffffffffffff', 'TimeUS,RDes,R,ROut,PDes,P,POut,YDes,Y,YOut,ADes,A,AOut')
  w.defineFormat(0x88, 'SIDD', 'Qfffffffff', 'TimeUS,Time,Targ,F,Gx,Gy,Gz,Ax,Ay,Az')
  w.defineFormat(0x89, 'IMU', 'QBffffff', 'TimeUS,I,GyrX,GyrY,GyrZ,AccX,AccY,AccZ')
  w.defineFormat(0x8a, 'EMPT', 'Qf', 'TimeUS,Never')

  const t0 = 5_000_000
  for (const [id, label] of [
    ['s', 's'],
    ['#', 'instance'],
    ['-', '']
  ] as const) {
    w.write('UNIT', [t0, id.charCodeAt(0), label])
  }
  for (const [id, m] of [
    ['-', 0],
    ['F', 1e-6]
  ] as const) {
    w.write('MULT', [t0, id.charCodeAt(0), m])
  }
  w.write('FMTU', [t0, 0x89, 's#------', 'F-------'])
  w.write('MSG', [t0, 'ArduCopter V4.5.1 (deadbeef)'])
  w.write('MODE', [t0 + 10, 25, 25, 2])

  // Yaw: r' = Nr r + Nped d + Npedp u, d' = wlag d + wlg u. Roll: p' = -4 p + 60 u.
  const nr = -0.5
  const nped = 40
  const npedp = 2
  const wlag = -15
  const wlg = 15
  let r = 0
  let d = 0
  let p = 0
  let phi = 0
  const samples = Math.round(duration * rate)
  const attFirst = Math.round(0.5 * rate)
  const attLast = samples - Math.round(1 * rate)
  for (let i = 0; i < samples; i++) {
    const t = i * dt
    const f = 0.3 + (8 * t) / duration
    const u = 0.1 * Math.sin(2 * Math.PI * f * t)
    const rDot = nr * r + nped * d + npedp * u
    d += (wlag * d + wlg * u) * dt
    r += rDot * dt
    const pDot = -4 * p + 60 * u
    p += pDot * dt
    phi += p * dt
    const timeUs = t0 + 1000 + Math.round(t * 1e6)
    w.write('RATE', [timeUs, 0, p * DEG, u, 0, 0, 0.5 * u, 0, r * DEG, u, 0, 0, 0.4 + 0.2 * u])
    w.write('SIDD', [timeUs + 50, t, u, f, p * DEG, 0.3 * p * DEG, r * DEG, 0.1 * pDot, 0.2 * pDot - 9.81 * phi, -9.81 + u])
    if (i >= attFirst && i < attLast) {
      w.write('ATT', [timeUs + 80, phi * DEG, phi * DEG, 0, 0.5 * phi * DEG, 0, 0, 0, 0])
    }
    if (i % 4 === 0) {
      w.write('IMU', [timeUs + 20, 0, p, 0, r, 0, 0, -9.81])
      w.write('IMU', [timeUs + 21, 1, p, 0, r, 0, 0, -9.81])
    }
  }
  return w.toBytes()
}
