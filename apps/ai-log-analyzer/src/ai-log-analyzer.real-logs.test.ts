/**
 * Real-log oracle, run only when `APWT_REAL_LOGS` names a directory of DataFlash `.bin` logs (the
 * logs are never part of the repository). For every log, upstream logAnalyzer.js (in node:vm, with
 * the upstream JsDataflashParser and the fake OpenAI server; no request leaves the process) and the
 * port load the same bytes, and:
 *
 * - upstream's `get` tool (`window.get`) and the port's `executeToolCall('get', ...)` answer every
 *   message type of the log, and the keys `message-data.test.ts` tries: the same uploaded JSON text,
 *   or the same failure where upstream uploads nothing;
 * - a chat turn whose run calls `get` for several types produces the same requests (uploaded files
 *   included) and chat lines on both sides, as `upstream-flow.test.ts` compares them.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { executeToolCall } from './analysis/tool-calls.js'
import { FakeOpenAiServer, type ApiRequest } from './test-utils/fake-openai.js'
import { PortAnalyzer, merged } from './test-utils/port-analyzer.js'
import { completed, requiresAction, textEvent } from './test-utils/stream-events.js'
import { UpstreamAnalyzer, loadUpstreamParser, type UpstreamParserCtor } from './test-utils/upstream-analyzer.js'

const dir = process.env['APWT_REAL_LOGS']
const files = dir
  ? readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.bin'))
      .sort()
  : []
const TIMEOUT = 900_000

/** The keys message-data.test.ts tries besides the log's own types. */
const ODD_KEYS = ['NOPE', 'att', 'IMU[0]', 'constructor', '__proto__', 'toString', 'undefined', 'null', '[object Object]', '']

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** Text of the `output.json` files uploaded in these requests. */
function uploads(requests: readonly ApiRequest[]): string[] {
  return requests.flatMap((r) => {
    if (r.method !== 'POST' || r.path !== '/files') return []
    const body = r.body as { file: { text: string } }
    return [body.file.text]
  })
}

describe.skipIf(!dir)('AI Log Analyzer on real logs (APWT_REAL_LOGS)', () => {
  let Parser: UpstreamParserCtor
  beforeAll(async () => {
    Parser = await loadUpstreamParser()
  })

  describe.each(files.length > 0 ? files : ['(no logs)'])('%s', (file) => {
    let buffer: ArrayBuffer
    let log: DataflashLog

    beforeAll(() => {
      buffer = toArrayBuffer(readFileSync(join(dir!, file)))
      log = DataflashLog.parse(buffer.slice(0))
    })

    it(
      'get answers every message type as upstream window.get uploads it',
      async () => {
        const server = new FakeOpenAiServer()
        const upstream = new UpstreamAnalyzer(server, Parser)
        await upstream.submitKey('sk-test')
        await upstream.loadLog(buffer.slice(0))
        // Every type upstream's parser lists, every type the port lists, and the odd keys.
        const parser = new Parser(false)
        const quiet = console.log
        console.log = () => undefined
        try {
          parser.processData(buffer.slice(0), [])
        } finally {
          console.log = quiet
        }
        const names = [...new Set([...Object.keys(parser.messageTypes), ...log.messageTypes().keys(), ...ODD_KEYS])]
        expect(names.length).toBeGreaterThan(ODD_KEYS.length + 5)
        let answered = 0
        for (const name of names) {
          server.log.length = 0
          const fileId = await upstream.callGet(name)
          const uploaded = uploads(server.log)
          const mine = executeToolCall('get', JSON.stringify({ message_type: name }), log)
          if (fileId === undefined) {
            expect(uploaded, name).toEqual([])
            expect(mine, name).toEqual({
              status: 'failure',
              reason: 'no-data',
              message: 'failure, requested message type does not exist in message types'
            })
          } else {
            expect(uploaded, name).toHaveLength(1)
            expect(mine.status, name).toBe('data')
            // Compared as text: a byte-for-byte match (no diff output for megabytes of JSON).
            const same = mine.status === 'data' && mine.json === uploaded[0]
            expect(same, `${name}: uploaded JSON differs`).toBe(true)
            answered++
          }
        }
        expect(answered).toBeGreaterThan(5)
      },
      TIMEOUT
    )

    it(
      'a run calling get for several types: same requests and chat as upstream',
      async () => {
        const setup = (s: FakeOpenAiServer) => {
          s.files = [{ id: 'file_old', filename: 'output.json' }]
          s.runs = [
            [
              requiresAction(
                'run_1',
                ['get', '{"message_type":"ATT"}'],
                ['get', '{"message_type":"PARM"}'],
                ['get', '{"message_type":"GPS"}'],
                ['get', '{"message_type":"XXXX"}']
              )
            ],
            [requiresAction('run_2', ['get', '{"message_type":"BAT"}'])],
            [textEvent('m', 'Done'), completed]
          ]
        }
        const upstreamServer = new FakeOpenAiServer()
        const portServer = new FakeOpenAiServer()
        setup(upstreamServer)
        setup(portServer)
        const upstream = new UpstreamAnalyzer(upstreamServer, Parser)
        const port = new PortAnalyzer(portServer)
        for (const side of [upstream, port]) {
          await side.submitKey('sk-test')
          await side.loadLog(buffer.slice(0))
          await side.send('check this log')
        }
        expect(portServer.log.length).toBe(upstreamServer.log.length)
        // Uploaded files first, compared as text, then the requests without them.
        const portUploads = uploads(portServer.log)
        const upstreamUploads = uploads(upstreamServer.log)
        // ATT, PARM and BAT are in every log.
        expect(upstreamUploads.length).toBeGreaterThanOrEqual(3)
        expect(portUploads.length).toBe(upstreamUploads.length)
        portUploads.forEach((text, i) => expect(text === upstreamUploads[i], `upload ${i}`).toBe(true))
        const withoutFiles = (requests: readonly ApiRequest[]) =>
          requests.map((r) => (r.method === 'POST' && r.path === '/files' ? { ...r, body: null } : r))
        expect(withoutFiles(portServer.log)).toEqual(withoutFiles(upstreamServer.log))
        expect(merged(port.chat())).toEqual(merged(upstream.chat()))
        expect(port.prompts).toBe(upstream.prompts)
        expect(port.clients).toEqual(upstream.clients)
      },
      TIMEOUT
    )
  })
})
