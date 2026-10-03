/**
 * Command-line helpers (upstream `SimpleGCS/node_ftp.js` and `SimpleGCS/cli_test.js`), using
 * Node's built-in WebSocket instead of the `ws` package. Run with tsx from the repository root:
 *
 *   npx tsx apps/simple-gcs/src/cli/simple-gcs-cli.ts fetch <ws-url> <passphrase> <remote-path> <output-file> [loss-percent]
 *   npx tsx apps/simple-gcs/src/cli/simple-gcs-cli.ts dump <ws-url> [passphrase]
 *
 * `fetch` downloads one file over MAVFTP, optionally dropping a percentage of FTP replies.
 * `dump` prints every decoded message and sends a 1 Hz GCS heartbeat.
 */
import { writeFileSync } from 'node:fs'
import {
  ALL_MESSAGES,
  FILE_TRANSFER_PROTOCOL,
  HEARTBEAT,
  MavAutopilot,
  MavlinkEncoder,
  MavlinkParser,
  MavlinkSigning,
  signingKeyFromPassphrase,
  type ReceivedMessage
} from '@apwt/mavlink'
import { systemClock } from '../clock.js'
import { MavFtpClient } from '../ftp/client.js'

function codec(systemId: number, componentId: number, passphrase: string): { encoder: MavlinkEncoder; parser: MavlinkParser } {
  if (!passphrase)
    return { encoder: new MavlinkEncoder({ systemId, componentId }), parser: new MavlinkParser({ messages: ALL_MESSAGES }) }
  const signing = new MavlinkSigning({ secretKey: signingKeyFromPassphrase(passphrase) })
  return {
    encoder: new MavlinkEncoder({ systemId, componentId, signing }),
    parser: new MavlinkParser({ messages: ALL_MESSAGES, signing })
  }
}

function openSocket(url: string): WebSocket {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  return ws
}

/** The text of a WebSocket error event (Node's WebSocket dispatches an ErrorEvent with a message). */
const errorMessage = (event: Event): string =>
  'message' in event && typeof event.message === 'string' && event.message !== '' ? event.message : 'WebSocket error'

const bytesOf = (data: unknown): Uint8Array => (data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(0))

/** upstream `node_ftp.js` */
function fetchFile(args: readonly string[]): void {
  const [url, passphrase, path, output, loss = '0'] = args
  const lossPercent = Number(loss)
  if (
    !url ||
    passphrase === undefined ||
    !path ||
    !output ||
    !Number.isFinite(lossPercent) ||
    lossPercent < 0 ||
    lossPercent > 100
  ) {
    console.error('Usage: simple-gcs-cli fetch <ws-url> <passphrase> <remote-path> <output-file> [loss-percent]')
    process.exit(1)
  }
  const systemId = 100 + Math.floor(Math.random() * 101)
  const { encoder, parser } = codec(systemId, 190, passphrase)
  const ws = openSocket(url)
  const ftp = new MavFtpClient(
    {
      sourceSystem: systemId,
      sourceComponent: 190,
      send: (payload, targetSystem, targetComponent) =>
        ws.send(
          Uint8Array.from(encoder.encode(FILE_TRANSFER_PROTOCOL, { targetNetwork: 0, targetSystem, targetComponent, payload }))
        )
    },
    systemClock
  )
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let started = false
  let finished = false
  const finish = (data: Uint8Array | null, error?: string): void => {
    if (finished) return
    finished = true
    clearInterval(heartbeat)
    clearTimeout(timeout)
    ftp.cancel()
    let failure = error
    if (data !== null) {
      try {
        writeFileSync(output, data)
        console.log(`Saved ${data.length} bytes to ${output}`)
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e)
      }
    } else failure ||= 'Failed to fetch file'
    if (failure) {
      console.error(failure)
      process.exitCode = 1
    }
    ws.close()
  }
  const timeout = setTimeout(() => finish(null, 'Download timed out'), 60000)
  const sendHeartbeat = (): void => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(
      Uint8Array.from(
        encoder.encode(HEARTBEAT, { type: 6, autopilot: 8, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
      )
    )
  }
  ws.addEventListener('open', () => {
    sendHeartbeat()
    heartbeat = setInterval(sendHeartbeat, 1000)
  })
  ws.addEventListener('message', (event) => {
    for (const msg of parser.push(bytesOf(event.data))) {
      if (msg.name === 'HEARTBEAT' && msg.fields.autopilot === MavAutopilot.MAV_AUTOPILOT_ARDUPILOTMEGA && !started) {
        started = true
        ftp.targetSystem = msg.header.systemId
        ftp.targetComponent = msg.header.componentId
        const virtual = path.startsWith('@PARAM/')
        ftp.getFile(path, (o) => finish(o.kind === 'done' ? o.value : null), { sizeIsEstimate: virtual, fixedReadSize: virtual })
      } else if (msg.name === 'FILE_TRANSFER_PROTOCOL' && Math.random() * 100 >= lossPercent) {
        ftp.handleMessage(msg)
      }
    }
  })
  ws.addEventListener('close', () => finish(null, 'Connection closed'))
  ws.addEventListener('error', (event) => finish(null, errorMessage(event)))
}

function fieldText(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value instanceof Uint8Array || value instanceof Int8Array || value instanceof Uint16Array || value instanceof Int16Array)
    return `[${Array.from(value).join(', ')}]`
  if (
    value instanceof Uint32Array ||
    value instanceof Int32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  )
    return `[${Array.from(value).join(', ')}]`
  if (value instanceof BigInt64Array || value instanceof BigUint64Array) return `[${Array.from(value).join(', ')}]`
  return typeof value === 'number' || typeof value === 'bigint' ? String(value) : ''
}

function pretty(msg: ReceivedMessage): string {
  // Upstream prints the dialect's snake_case field names, in definition order as the codec does.
  const fields = Object.entries(msg.fields).map(
    ([name, value]: [string, unknown]) => `${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}=${fieldText(value)}`
  )
  return `${msg.name} { ${fields.join(', ')} }`
}

/** upstream `cli_test.js` */
function dump(args: readonly string[]): void {
  const [url, passphrase = ''] = args
  if (!url) {
    console.error('Usage: simple-gcs-cli dump <WebSocket URL> [passphrase]')
    process.exit(1)
  }
  const { encoder, parser } = codec(255, 190, passphrase)
  const ws = openSocket(url)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  ws.addEventListener('open', () => {
    console.log(`Connected to ${url}`)
    heartbeat = setInterval(() => {
      try {
        ws.send(
          Uint8Array.from(
            encoder.encode(HEARTBEAT, { type: 6, autopilot: 8, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
          )
        )
        console.log('Sent HEARTBEAT')
      } catch (e) {
        console.error('Error sending HEARTBEAT:', e instanceof Error ? e.message : e)
        if (e instanceof Error) console.error(e.stack)
      }
    }, 1000)
  })
  ws.addEventListener('message', (event) => {
    const buf = bytesOf(event.data)
    console.log(`Received ${buf.length} bytes: [${Buffer.from(buf.subarray(0, 10)).toString('hex')}...]`)
    for (const event of parser.parse(buf)) {
      if (event.kind === 'message') {
        console.log(`MAVLink message ID: ${event.message.id}`)
        console.log(pretty(event.message))
        continue
      }
      // Upstream's parser returns a BAD_DATA message (id -1, no fields) for anything it cannot
      // decode, one per stray byte as it is fed byte by byte, and prints it like any other.
      const count = event.kind === 'garbage' && event.reason === 'noise' ? event.bytes.length : 1
      for (let i = 0; i < count; i++) {
        console.log('MAVLink message ID: -1')
        console.log('<invalid MAVLink message>')
      }
    }
  })
  ws.addEventListener('close', () => {
    console.log('WebSocket closed')
    clearInterval(heartbeat)
  })
  ws.addEventListener('error', (event) => console.error('WebSocket error:', errorMessage(event)))
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'fetch') fetchFile(rest)
else if (command === 'dump') dump(rest)
else {
  console.error('Usage: simple-gcs-cli <fetch|dump> ...')
  process.exitCode = 1
}
