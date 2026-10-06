import { describe, expect, it } from 'vitest'
import { normalizeCodexExecLine } from './codex-exec-event-normalizer'

const line = (value: unknown): string => JSON.stringify(value)

function eventOf(text: string) {
  const normalized = normalizeCodexExecLine(text)
  if (normalized.kind !== 'event') {
    throw new Error(`expected an event, got ${normalized.kind}`)
  }
  return normalized
}

describe('normalizeCodexExecLine documented events', () => {
  it('normalizes thread.started with its thread id', () => {
    const { event } = eventOf(
      line({ type: 'thread.started', thread_id: '0199a213-81c0-7800-8aa1' })
    )
    expect(event).toEqual({ kind: 'thread_started', threadId: '0199a213-81c0-7800-8aa1' })
  })

  it.each([
    { type: 'thread.started' },
    { type: 'thread.started', thread_id: 7 },
    { type: 'thread.started', thread_id: '' },
    { type: 'thread.started', thread_id: 'x'.repeat(200) },
    { type: 'thread.started', thread_id: 'bad\u0007id' }
  ])('treats a thread.started without a usable id as unknown: %j', (payload) => {
    const { event } = eventOf(line(payload))
    expect(event.kind).toBe('unknown')
  })

  it('normalizes turn.started', () => {
    expect(eventOf(line({ type: 'turn.started' })).event).toEqual({ kind: 'turn_started' })
  })

  it('normalizes turn.completed usage field by field', () => {
    const { event } = eventOf(
      line({
        type: 'turn.completed',
        usage: {
          input_tokens: 24763,
          cached_input_tokens: 24448,
          output_tokens: 122,
          reasoning_output_tokens: 64
        }
      })
    )
    expect(event).toEqual({
      kind: 'turn_completed',
      usage: {
        inputTokens: 24763,
        cachedInputTokens: 24448,
        outputTokens: 122,
        reasoningOutputTokens: 64
      }
    })
  })

  it('reports a missing or malformed usage field as null rather than inventing it', () => {
    const partial = eventOf(
      line({
        type: 'turn.completed',
        usage: { input_tokens: 5, output_tokens: -1, cached_input_tokens: '9' }
      })
    ).event
    expect(partial).toEqual({
      kind: 'turn_completed',
      usage: {
        inputTokens: 5,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningOutputTokens: null
      }
    })
    expect(eventOf(line({ type: 'turn.completed' })).event).toEqual({
      kind: 'turn_completed',
      usage: null
    })
    expect(eventOf(line({ type: 'turn.completed', usage: 'many' })).event).toEqual({
      kind: 'turn_completed',
      usage: null
    })
  })

  it('normalizes turn.failed and error messages, bounded and redacted', () => {
    const failed = eventOf(line({ type: 'turn.failed', error: { message: 'model overloaded' } }))
    expect(failed.event).toEqual({ kind: 'turn_failed', message: 'model overloaded' })

    const error = eventOf(line({ type: 'error', message: 'stream disconnected' }))
    expect(error.event).toEqual({ kind: 'error', message: 'stream disconnected' })

    const noMessage = eventOf(line({ type: 'error' }))
    expect(noMessage.event).toEqual({ kind: 'error', message: null })

    const long = eventOf(
      line({ type: 'error', message: `${'m'.repeat(900)} sk-FIXTUREONLY1234567890abcdef` })
    )
    if (long.event.kind !== 'error') {
      throw new Error('expected an error event')
    }
    expect(long.event.message?.length).toBeLessThanOrEqual(500)
  })

  it('redacts a secret in an error message', () => {
    const { event } = eventOf(
      line({ type: 'error', message: 'Incorrect API key provided: sk-FIXTUREONLY1234567890abcdef' })
    )
    expect(JSON.stringify(event)).not.toContain('sk-FIXTUREONLY1234567890abcdef')
  })
})

describe('normalizeCodexExecLine items', () => {
  it('keeps item metadata but never message text', () => {
    const secretText = 'FINAL-ANSWER-TEXT-SENTINEL'
    const { event } = eventOf(
      line({
        type: 'item.completed',
        item: { id: 'item_3', type: 'agent_message', text: secretText }
      })
    )
    expect(event).toEqual({
      kind: 'item',
      phase: 'completed',
      itemType: 'agent_message',
      itemId: 'item_3',
      status: null,
      summary: null
    })
    expect(JSON.stringify(event)).not.toContain(secretText)
  })

  it.each([
    ['item.started', 'started'],
    ['item.updated', 'updated'],
    ['item.completed', 'completed']
  ])('maps %s to phase %s', (type, phase) => {
    const { event } = eventOf(line({ type, item: { id: 'i', type: 'web_search' } }))
    expect(event).toMatchObject({ kind: 'item', phase, itemType: 'web_search' })
  })

  it('summarizes a command by its command line only, bounded and redacted', () => {
    const { event } = eventOf(
      line({
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'command_execution',
          command: `curl -H "Authorization: Bearer FIXTUREONLYtoken.value-123" ${'z'.repeat(600)}`,
          aggregated_output: 'OUTPUT-SENTINEL',
          exit_code: 0,
          status: 'completed'
        }
      })
    )
    if (event.kind !== 'item') {
      throw new Error('expected an item event')
    }
    expect(event.status).toBe('completed')
    expect(event.summary?.length).toBeLessThanOrEqual(300)
    expect(event.summary).not.toContain('FIXTUREONLYtoken.value-123')
    expect(JSON.stringify(event)).not.toContain('OUTPUT-SENTINEL')
  })

  it('summarizes a file change by its paths', () => {
    const { event } = eventOf(
      line({
        type: 'item.completed',
        item: {
          id: 'item_2',
          type: 'file_change',
          changes: [
            { path: 'src/a.ts', kind: 'update' },
            { path: 'src/b.ts', kind: 'add' }
          ],
          status: 'completed'
        }
      })
    )
    expect(event).toMatchObject({
      kind: 'item',
      itemType: 'file_change',
      summary: 'src/a.ts, src/b.ts'
    })
  })

  it('tolerates an item with missing or odd fields', () => {
    expect(eventOf(line({ type: 'item.completed' })).event).toMatchObject({
      kind: 'item',
      itemType: 'unknown',
      itemId: null
    })
    expect(eventOf(line({ type: 'item.completed', item: 'text' })).event).toMatchObject({
      kind: 'item',
      itemType: 'unknown'
    })
  })

  it('omits reasoning items entirely', () => {
    const reasoning = 'REASONING-SENTINEL'
    for (const type of ['item.started', 'item.updated', 'item.completed']) {
      const normalized = normalizeCodexExecLine(
        line({ type, item: { id: 'item_0', type: 'reasoning', text: reasoning } })
      )
      expect(normalized).toEqual({ kind: 'reasoning_omitted' })
    }
  })

  it('omits unknown reasoning-flavoured events instead of keeping them raw', () => {
    expect(normalizeCodexExecLine(line({ type: 'reasoning.delta', text: 'x' }))).toEqual({
      kind: 'reasoning_omitted'
    })
    expect(
      normalizeCodexExecLine(line({ type: 'item.mystery', item: { type: 'reasoning', text: 'x' } }))
    ).toEqual({ kind: 'reasoning_omitted' })
  })
})

describe('normalizeCodexExecLine unknown and malformed lines', () => {
  it('keeps unknown events raw but bounded', () => {
    const { event } = eventOf(line({ type: 'plan.updated', steps: ['a', 'b'] }))
    expect(event).toEqual({
      kind: 'unknown',
      eventType: 'plan.updated',
      raw: '{"type":"plan.updated","steps":["a","b"]}',
      rawTruncated: false
    })

    const big = eventOf(line({ type: 'plan.updated', blob: 'q'.repeat(10_000) }))
    if (big.event.kind !== 'unknown') {
      throw new Error('expected unknown')
    }
    expect(big.event.rawTruncated).toBe(true)
    expect(big.event.raw.length).toBeLessThanOrEqual(2048)
  })

  it('treats item.<other> phases as unknown rather than guessing', () => {
    expect(
      eventOf(line({ type: 'item.deleted', item: { id: 'x', type: 'web_search' } })).event.kind
    ).toBe('unknown')
  })

  it.each([
    ['Reading prompt from stdin...', 'invalid_json'],
    ['{"type":', 'invalid_json'],
    ['[1,2,3]', 'not_an_object'],
    ['42', 'not_an_object'],
    ['null', 'not_an_object'],
    ['{"foo":1}', 'missing_type'],
    ['{"type":5}', 'missing_type'],
    ['{"type":""}', 'missing_type']
  ])('flags %j as non-event (%s)', (text, reason) => {
    expect(normalizeCodexExecLine(text)).toMatchObject({ kind: 'non_json', reason })
  })

  it('bounds and redacts the preview of a non-JSON line', () => {
    const normalized = normalizeCodexExecLine(
      `oops sk-FIXTUREONLY1234567890abcdef ${'p'.repeat(500)}`
    )
    if (normalized.kind !== 'non_json') {
      throw new Error('expected non_json')
    }
    expect(normalized.preview.length).toBeLessThanOrEqual(200)
    expect(normalized.preview).not.toContain('sk-FIXTUREONLY1234567890abcdef')
  })
})

describe('normalizeCodexExecLine thread ids', () => {
  it.each(['0199a213-81c0-7800-8aa1', 'thread_1:abc.def', 'a', 'T'.repeat(128)])(
    'accepts %s',
    (threadId) => {
      const { event } = eventOf(line({ type: 'thread.started', thread_id: threadId }))
      expect(event).toEqual({ kind: 'thread_started', threadId })
    }
  )

  it.each([
    '-resume',
    '--last',
    ' leading',
    'has space',
    'tab\there',
    '.hidden',
    ':x',
    'é',
    'T'.repeat(129)
  ])('treats %j as unusable, so it can never become a flag', (threadId) => {
    expect(eventOf(line({ type: 'thread.started', thread_id: threadId })).event.kind).toBe(
      'unknown'
    )
  })
})

describe('normalizeCodexExecLine hostile input stays cheap and bounded', () => {
  const HUGE = 1024 * 1024
  const elapsed = (run: () => unknown): number => {
    const started = performance.now()
    run()
    return performance.now() - started
  }

  it.each([
    [
      'a command',
      line({
        type: 'item.started',
        item: { type: 'command_execution', command: 'a'.repeat(HUGE / 2) }
      })
    ],
    ['an error message', line({ type: 'error', message: 'a-'.repeat(HUGE / 4) })],
    [
      'a turn.failed message',
      line({ type: 'turn.failed', error: { message: 'eyJ-'.repeat(HUGE / 8) } })
    ],
    ['an unknown event', line({ type: 'plan.updated', blob: 'a'.repeat(HUGE / 2) })],
    ['a non-JSON line', 'token='.repeat(HUGE / 12)]
  ])('normalizes %s of about 1 MiB in under 100 ms', (_label, text) => {
    expect(elapsed(() => normalizeCodexExecLine(text))).toBeLessThan(100)
  })

  it('bounds item ids, statuses and event types', () => {
    const big = 'q'.repeat(100_000)
    const item = eventOf(
      line({ type: 'item.completed', item: { id: big, type: 'agent_message', status: big } })
    ).event
    if (item.kind !== 'item') {
      throw new Error('expected an item event')
    }
    expect(item.itemId?.length).toBeLessThanOrEqual(128)
    expect(item.status?.length).toBeLessThanOrEqual(64)
    const unknown = eventOf(line({ type: big })).event
    if (unknown.kind !== 'unknown') {
      throw new Error('expected an unknown event')
    }
    expect(unknown.eventType.length).toBeLessThanOrEqual(64)
  })

  it('keeps a secret out of a long command even when it sits near the cut', () => {
    const { event } = eventOf(
      line({
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: `${'x'.repeat(280)} sk-FIXTUREONLYFIXTUREONLY1234`
        }
      })
    )
    expect(JSON.stringify(event)).not.toContain('FIXTUREONLYFIXTURE')
  })
})

describe('normalizeCodexExecLine reported model', () => {
  it('reads a top-level model string only, and never invents one', () => {
    expect(eventOf(line({ type: 'turn.started', model: 'gpt-6-astra' })).reportedModel).toBe(
      'gpt-6-astra'
    )
    expect(eventOf(line({ type: 'turn.started' })).reportedModel).toBeNull()
    expect(eventOf(line({ type: 'turn.started', model: 5 })).reportedModel).toBeNull()
    expect(eventOf(line({ type: 'turn.started', model: 'Not A Slug' })).reportedModel).toBeNull()
    expect(
      eventOf(
        line({
          type: 'item.completed',
          item: { id: 'i', type: 'agent_message', model: 'gpt-6-astra' }
        })
      ).reportedModel
    ).toBeNull()
  })
})
