import { describe, expect, it } from 'vitest'
import type { WorkbenchAttemptTranscriptReadResult } from '../../../../shared/rpc-contract/workbench-task-window-params'
import {
  TRANSCRIPT_READ_BYTES,
  applyTranscriptRead,
  initialTranscriptState,
  planNextTranscriptRead,
  withTranscriptError,
  type TranscriptReadState
} from './task-window-transcript-state'
import { transcriptRowsFrom } from './task-window-row-log'

const START = '{"v":1,"seq":0,"at":"2026-10-05T18:00:00.000Z","kind":"start","executor":"agy"}\n'
const LINE =
  '{"v":1,"seq":1,"at":"2026-10-05T18:00:01.000Z","kind":"output","stream":"stdout","text":"hi"}\n'
const END =
  '{"v":1,"seq":2,"at":"2026-10-05T18:00:02.000Z","kind":"end","state":"completed","exitCode":0,"reasonCode":null}\n'

function result(
  overrides: Partial<WorkbenchAttemptTranscriptReadResult>
): WorkbenchAttemptTranscriptReadResult {
  return {
    chunk: '',
    nextByteOffset: 0,
    fileIdentity: 'id-1',
    reset: false,
    truncated: false,
    live: true,
    ended: false,
    ...overrides
  }
}

const rowsOf = (state: TranscriptReadState) => transcriptRowsFrom(state.rows, 0)

function apply(state = initialTranscriptState('ctx_1'), chunk = START, overrides = {}) {
  return applyTranscriptRead(
    state,
    result({ chunk, nextByteOffset: state.nextByteOffset + chunk.length, ...overrides }),
    state.nextByteOffset
  )
}

describe('applyTranscriptRead', () => {
  it('parses whole lines, advances the offset and keeps the flags', () => {
    const state = apply(undefined, START + LINE, { truncated: true })
    expect(rowsOf(state).map((row) => row.kind)).toEqual(['start', 'output'])
    expect(state).toMatchObject({
      nextByteOffset: (START + LINE).length,
      fileIdentity: 'id-1',
      live: true,
      ended: false,
      truncated: true,
      loaded: true
    })
  })

  it('carries a partial line until the rest arrives', () => {
    const first = apply(undefined, START + LINE.slice(0, 30))
    expect(first.rows.length).toBe(1)
    const second = apply(first, LINE.slice(30))
    expect(rowsOf(second).map((row) => row.kind)).toEqual(['start', 'output'])
  })

  it('numbers lines across reads so row keys stay stable', () => {
    const second = apply(apply(undefined, START), LINE)
    expect(rowsOf(second).map((row) => row.line)).toEqual([0, 1])
  })

  it('starts over on reset and when the file identity changes', () => {
    const read = apply(undefined, START + LINE)
    const reset = applyTranscriptRead(read, result({ reset: true, nextByteOffset: 0 }), 99)
    expect(reset).toMatchObject({ rows: { length: 0 }, nextByteOffset: 0, restart: true })
    const replaced = applyTranscriptRead(
      read,
      result({ chunk: LINE, fileIdentity: 'id-2', nextByteOffset: 400 }),
      read.nextByteOffset
    )
    expect(replaced).toMatchObject({ rows: { length: 0 }, nextByteOffset: 0, restart: true })
  })

  it('keeps the last unterminated line once a settled attempt is read to its end', () => {
    const state = apply(undefined, `${START}{"v":1,"kind":"mess`, { live: false })
    expect(rowsOf(state).map((row) => row.kind)).toEqual(['start', 'malformed'])
  })

  it('records the end of the transcript', () => {
    const state = apply(apply(undefined, START), END, { ended: true, live: false })
    expect(state).toMatchObject({ ended: true, live: false })
    expect(rowsOf(state).at(-1)?.kind).toBe('end')
  })

  it('shares the rows of earlier reads instead of copying them on every read (L8)', () => {
    const first = apply(undefined, START + LINE.repeat(300))
    const second = apply(first, LINE)
    expect(second.rows.length).toBe(302)
    expect(second.rows.chunks[0]).toBe(first.rows.chunks[0])
    expect(second.rows.start?.kind).toBe('start')
  })
})

describe('withTranscriptError', () => {
  it('marks a transcript that was never recorded as missing, and other failures as errors', () => {
    const initial = initialTranscriptState('ctx_1')
    expect(
      withTranscriptError(initial, { code: 'workbench_transcript_missing', message: 'x' })
    ).toMatchObject({
      missing: true,
      error: null,
      loaded: true
    })
    expect(
      withTranscriptError(initial, { code: 'request_failed', message: 'Lost.' })
    ).toMatchObject({
      missing: false,
      error: { code: 'request_failed', message: 'Lost.' }
    })
  })
})

describe('planNextTranscriptRead', () => {
  const live = apply(undefined, START)

  it('reads every second while live and stops after the end record', () => {
    expect(planNextTranscriptRead(live, { consumed: START.length, graceLeft: 3 })).toBe(1000)
    expect(
      planNextTranscriptRead({ ...live, ended: true }, { consumed: 0, graceLeft: 3 })
    ).toBeNull()
  })

  it('reads again at once while a full window suggests more is waiting, or after a reset', () => {
    expect(planNextTranscriptRead(live, { consumed: TRANSCRIPT_READ_BYTES, graceLeft: 3 })).toBe(0)
    expect(planNextTranscriptRead({ ...live, restart: true }, { consumed: 0, graceLeft: 3 })).toBe(
      0
    )
  })

  it('gives a settled attempt a few more reads for its end record, then stops', () => {
    const settled = { ...live, live: false }
    expect(planNextTranscriptRead(settled, { consumed: 0, graceLeft: 1 })).toBe(1000)
    expect(planNextTranscriptRead(settled, { consumed: 0, graceLeft: 0 })).toBeNull()
  })

  it('stops for a missing or refused transcript and retries other failures slowly', () => {
    expect(
      planNextTranscriptRead({ ...live, missing: true }, { consumed: 0, graceLeft: 3 })
    ).toBeNull()
    const refused = { ...live, error: { code: 'workbench_transcript_refused', message: 'x' } }
    expect(planNextTranscriptRead(refused, { consumed: 0, graceLeft: 3 })).toBeNull()
    const failed = { ...live, error: { code: 'request_failed', message: 'x' } }
    expect(planNextTranscriptRead(failed, { consumed: 0, graceLeft: 3 })).toBe(5000)
  })
})
