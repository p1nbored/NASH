import { describe, expect, it } from 'vitest'
import type { JsonlLine } from './codex-exec-jsonl-line-reader'
import { createCodexExecStreamState } from './codex-exec-stream-state'

let lineNumber = 0
const event = (value: unknown): JsonlLine => {
  lineNumber += 1
  return { kind: 'line', text: JSON.stringify(value), lineNumber }
}
const raw = (text: string): JsonlLine => {
  lineNumber += 1
  return { kind: 'line', text, lineNumber }
}

describe('createCodexExecStreamState', () => {
  it('counts the documented events and tracks the terminal event', () => {
    const state = createCodexExecStreamState()
    state.acceptLine(event({ type: 'thread.started', thread_id: 't-1' }))
    state.acceptLine(event({ type: 'turn.started' }))
    state.acceptLine(
      event({ type: 'item.completed', item: { id: 'a', type: 'command_execution' } })
    )
    state.acceptLine(event({ type: 'item.completed', item: { id: 'b', type: 'agent_message' } }))
    state.acceptLine(
      event({
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 2,
          output_tokens: 3,
          reasoning_output_tokens: 1
        }
      })
    )
    const summary = state.summary()
    expect(summary).toMatchObject({
      eventCount: 5,
      threadStartedCount: 1,
      threadIds: ['t-1'],
      turnStartedCount: 1,
      turnCompletedCount: 1,
      turnFailedCount: 0,
      errorEventCount: 0,
      finalTurnEvent: 'turn.completed',
      usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 1 },
      itemCounts: { command_execution: 1, agent_message: 1 }
    })
  })

  it('makes the last terminal event final, so a failure after completion is visible', () => {
    const state = createCodexExecStreamState()
    state.acceptLine(event({ type: 'turn.completed', usage: {} }))
    state.acceptLine(event({ type: 'error', message: 'late failure' }))
    const summary = state.summary()
    expect(summary.finalTurnEvent).toBe('error')
    expect(summary.errorEventCount).toBe(1)
    expect(summary.failureMessages).toEqual(['late failure'])
  })

  it('counts every thread.started so a second one can be rejected', () => {
    const state = createCodexExecStreamState()
    state.acceptLine(event({ type: 'thread.started', thread_id: 't-1' }))
    state.acceptLine(event({ type: 'thread.started', thread_id: 't-2' }))
    expect(state.summary()).toMatchObject({ threadStartedCount: 2, threadIds: ['t-1', 't-2'] })
  })

  it('omits reasoning items from every output and counts them', () => {
    const state = createCodexExecStreamState()
    const seen = state.acceptLine(
      event({
        type: 'item.completed',
        item: { id: 'r', type: 'reasoning', text: 'REASONING-SENTINEL' }
      })
    )
    expect(seen).toBeNull()
    const summary = state.summary()
    expect(summary.reasoningItemsOmitted).toBe(1)
    expect(summary.eventCount).toBe(0)
    expect(summary.itemCounts).toEqual({})
    expect(JSON.stringify(summary)).not.toContain('REASONING-SENTINEL')
  })

  it('keeps a bounded number of unknown events but counts all of them', () => {
    const state = createCodexExecStreamState({ maxUnknownEvents: 2 })
    for (let index = 0; index < 5; index += 1) {
      state.acceptLine(event({ type: 'plan.updated', index }))
    }
    const summary = state.summary()
    expect(summary.unknownEventCount).toBe(5)
    expect(summary.unknownEvents).toHaveLength(2)
    expect(summary.unknownEvents[0]).toMatchObject({ eventType: 'plan.updated' })
  })

  it('flags non-JSON lines with their line numbers, keeping a bounded sample', () => {
    const state = createCodexExecStreamState({ maxNonJsonSamples: 2 })
    state.acceptLine(raw('hello'))
    state.acceptLine(raw('[1]'))
    state.acceptLine(raw('{"nope":1}'))
    const summary = state.summary()
    expect(summary.nonJsonLineCount).toBe(3)
    expect(summary.nonJsonLines).toHaveLength(2)
    expect(summary.nonJsonLines[0]).toMatchObject({ reason: 'invalid_json', preview: 'hello' })
    expect(summary.eventCount).toBe(0)
  })

  it('flags oversized lines and treats an oversized control event as unreliable', () => {
    const state = createCodexExecStreamState()
    state.acceptLine({
      kind: 'oversized',
      lineNumber: 1,
      totalBytes: 5000,
      prefix: '{"type":"item.completed","item":{"id":"x"'
    })
    expect(state.summary()).toMatchObject({
      oversizedLineCount: 1,
      oversizedControlEvent: false,
      oversizedLines: [{ lineNumber: 1, totalBytes: 5000, typeHint: 'item.completed' }]
    })

    for (const type of ['turn.completed', 'turn.failed', 'error', 'thread.started']) {
      const control = createCodexExecStreamState()
      control.acceptLine({
        kind: 'oversized',
        lineNumber: 1,
        totalBytes: 9000,
        prefix: `{ "type" : "${type}", "pad":"`
      })
      expect(control.summary().oversizedControlEvent).toBe(true)
    }

    const unhinted = createCodexExecStreamState()
    unhinted.acceptLine({ kind: 'oversized', lineNumber: 1, totalBytes: 9000, prefix: 'garbage' })
    expect(unhinted.summary().oversizedLines[0]).toMatchObject({ typeHint: null })
    // Fail closed: a line whose type cannot be read may have been a control event.
    expect(unhinted.summary().oversizedControlEvent).toBe(true)
  })

  it('bounds the retained normalized events and reports what it dropped', () => {
    const state = createCodexExecStreamState({ maxEvents: 3 })
    for (let index = 0; index < 10; index += 1) {
      state.acceptLine(event({ type: 'turn.started' }))
    }
    const summary = state.summary()
    expect(summary.events).toHaveLength(3)
    expect(summary.droppedEvents).toBe(7)
    expect(summary.turnStartedCount).toBe(10)
    expect(summary.eventCount).toBe(10)
  })

  it('keeps the first reported model and null when no event reports one', () => {
    const none = createCodexExecStreamState()
    none.acceptLine(event({ type: 'turn.started' }))
    expect(none.summary().reportedModel).toBeNull()

    const some = createCodexExecStreamState()
    some.acceptLine(event({ type: 'turn.started', model: 'gpt-6-astra' }))
    some.acceptLine(event({ type: 'turn.completed', model: 'gpt-6.1-sol' }))
    expect(some.summary().reportedModel).toBe('gpt-6-astra')
  })

  it('returns the normalized event so a caller can observe progress', () => {
    const state = createCodexExecStreamState()
    expect(state.acceptLine(event({ type: 'turn.started' }))).toEqual({ kind: 'turn_started' })
    expect(state.acceptLine(raw('not json'))).toBeNull()
  })

  it('returns independent snapshots', () => {
    const state = createCodexExecStreamState()
    state.acceptLine(event({ type: 'turn.started' }))
    const first = state.summary()
    state.acceptLine(event({ type: 'turn.started' }))
    expect(first.turnStartedCount).toBe(1)
    expect(state.summary().turnStartedCount).toBe(2)
  })
})

describe('createCodexExecStreamState control-event loss', () => {
  it.each([
    ['a truncated turn.completed', '{"type":"turn.completed","usage":{"input_tokens":1'],
    ['a truncated error', '{"type":"error","message":"stream disc'],
    ['a control event behind interleaved noise', 'noise{"type":"turn.failed","error":{}'],
    ['a truncated thread.started with spacing', '{ "type" : "thread.started", "thread_id":']
  ])('flags %s as a malformed control event', (_label, text) => {
    const state = createCodexExecStreamState()
    state.acceptLine(raw(text))
    expect(state.summary()).toMatchObject({ nonJsonLineCount: 1, malformedControlEvent: true })
  })

  it.each([
    ['plain prose', 'Reading prompt from stdin...'],
    ['a truncated non-control event', '{"type":"turn.started"'],
    ['a truncated item event', '{"type":"item.completed","item":{'],
    ['valid JSON that is not an object', '[{"type":"error"}]']
  ])('does not flag %s', (_label, text) => {
    const state = createCodexExecStreamState()
    state.acceptLine(raw(text))
    expect(state.summary().malformedControlEvent).toBe(false)
  })
})

describe('createCodexExecStreamState untrusted keys and strings', () => {
  const item = (type: string) => event({ type: 'item.completed', item: { id: 'i', type } })

  it('counts item types in a null-prototype record so inherited names cannot corrupt a count', () => {
    const state = createCodexExecStreamState()
    for (const type of ['constructor', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      state.acceptLine(item(type))
    }
    const counts = state.summary().itemCounts
    expect(Object.getPrototypeOf(counts)).toBeNull()
    expect(counts.constructor).toBe(2)
    expect(counts.toString).toBe(1)
    expect(counts.hasOwnProperty).toBe(1)
    expect(JSON.parse(JSON.stringify(counts))).toEqual({ ...counts })
    expect(Object.values(counts).every((value) => typeof value === 'number')).toBe(true)
  })

  it('collapses oddly spelled item types into an other bucket and cuts over-long ones to 64 characters', () => {
    const state = createCodexExecStreamState()
    state.acceptLine(item('web search'))
    state.acceptLine(item('x'.repeat(500)))
    state.acceptLine(item(`tool${String.fromCharCode(7)}call`))
    expect({ ...state.summary().itemCounts }).toEqual({ other: 2, [`${'x'.repeat(64)}`]: 1 })
  })

  it('caps the number of distinct item types it will track', () => {
    const state = createCodexExecStreamState()
    for (let index = 0; index < 500; index += 1) {
      state.acceptLine(item(`type_${index}`))
    }
    const counts = state.summary().itemCounts
    expect(Object.keys(counts).length).toBeLessThanOrEqual(65)
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(500)
  })

  it('keeps at most a few thread ids but counts every thread.started', () => {
    const state = createCodexExecStreamState()
    for (let index = 0; index < 10; index += 1) {
      state.acceptLine(event({ type: 'thread.started', thread_id: `t-${index}` }))
    }
    expect(state.summary().threadStartedCount).toBe(10)
    expect(state.summary().threadIds).toHaveLength(4)
  })

  it('bounds the fields it retains from a hostile event', () => {
    const state = createCodexExecStreamState()
    const big = 'q'.repeat(200_000)
    state.acceptLine(
      event({ type: 'item.completed', item: { id: big, type: 'agent_message', status: big } })
    )
    state.acceptLine(event({ type: big }))
    const summary = state.summary()
    const kept = summary.events.map((entry) => JSON.stringify(entry).length)
    expect(Math.max(...kept)).toBeLessThan(2_600)
    expect(JSON.stringify(summary).length).toBeLessThan(10_000)
  })
})
