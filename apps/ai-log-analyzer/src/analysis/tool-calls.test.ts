import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { buildSyntheticLog } from '@apwt/dataflash/testing'
import { getMessageColumns } from './message-data.js'
import { executeToolCall } from './tool-calls.js'
import {
  ASSISTANT_TOOLS,
  FUNCTION_TOOL_NAMES,
  isFunctionToolName,
  type ToolArguments,
  type ToolCall
} from './tool-definitions.js'

const log = DataflashLog.parse(buildSyntheticLog())

describe('tool definitions', () => {
  it('match upstream assistantTools.json exactly', () => {
    const upstream: unknown = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../upstream/AILogAnalyzer/assistantTools.json'), 'utf8')
    )
    expect(ASSISTANT_TOOLS).toEqual(upstream)
  })

  it('derive names and argument types from the table', () => {
    expect(FUNCTION_TOOL_NAMES).toEqual(['get'])
    expect(isFunctionToolName('get')).toBe(true)
    expect(isFunctionToolName('code_interpreter')).toBe(false)
    expectTypeOf<ToolArguments<'get'>>().toEqualTypeOf<{ readonly message_type: string }>()
    expectTypeOf<ToolCall>().toEqualTypeOf<{ readonly name: 'get'; readonly args: { readonly message_type: string } }>()
  })
})

describe('executeToolCall', () => {
  it('answers get with the message data as JSON', () => {
    const result = executeToolCall('get', '{"message_type":"ATT"}', log)
    expect(result.status).toBe('data')
    if (result.status !== 'data') return
    expect(result.summary).toBe('ATT: 25 records, 9 fields')
    expect(result.json).toBe(JSON.stringify(getMessageColumns(log, 'ATT')))
  })

  it('uses message_type as a property key, like upstream', () => {
    // No trimming or case folding: upstream looked the key up with `in`.
    expect(executeToolCall('get', '{"message_type":" IMU "}', log)).toMatchObject({ status: 'failure', reason: 'no-data' })
    expect(executeToolCall('get', '{"message_type":"att"}', log)).toMatchObject({ status: 'failure', reason: 'no-data' })
    // Missing, numeric, array and object keys are converted with String() and are not found.
    for (const args of [
      '{}',
      '{"message_type":5}',
      '{"message_type":["ATT","GPS"]}',
      '{"message_type":{}}',
      '[]',
      '7',
      '"ATT"'
    ]) {
      expect(executeToolCall('get', args, log), args).toEqual({
        status: 'failure',
        reason: 'no-data',
        message: 'failure, requested message type does not exist in message types'
      })
    }
    // A one-element array converts to its element, as `["ATT"] in obj` does.
    expect(executeToolCall('get', '{"message_type":["ATT"]}', log).status).toBe('data')
    // Extra arguments are ignored.
    expect(executeToolCall('get', '{"message_type":"ATT","instance":1}', log).status).toBe('data')
  })

  it('reports unsupported functions with the upstream message', () => {
    expect(executeToolCall('plot', '{}', log)).toEqual({
      status: 'failure',
      reason: 'unsupported',
      message: 'failure, the function that was called is not supported'
    })
  })

  it('reports a missing log with the upstream message, before reading the arguments', () => {
    const noLog = { status: 'failure', reason: 'no-log', message: 'failure, user did not upload logs file' }
    expect(executeToolCall('get', '{"message_type":"ATT"}', null)).toEqual(noLog)
    expect(executeToolCall('get', 'null', null)).toEqual(noLog)
  })

  it('crashes where upstream threw', () => {
    // JSON.parse ran before any other check.
    expect(executeToolCall('plot', '{message_type: ATT', log).status).toBe('crash')
    expect(executeToolCall('get', '{message_type: ATT', null).status).toBe('crash')
    // `null.message_type` threw once a log was loaded.
    expect(executeToolCall('get', 'null', log)).toEqual({
      status: 'crash',
      message: "Cannot read properties of null (reading 'message_type')"
    })
  })

  it('answers from a real log', () => {
    const real = DataflashLog.parse(
      readFileSync(resolve(__dirname, '../../../../packages/dataflash/test-fixtures/copter-sitl.bin'))
    )
    const result = executeToolCall('get', '{"message_type":"PARM"}', real)
    expect(result.status).toBe('data')
    if (result.status !== 'data') return
    const parsed = JSON.parse(result.json) as { Name: string[] }
    expect(parsed.Name).toContain('ATC_RAT_RLL_P')
  })
})
