import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { readAttemptTranscript } from './attempt-transcript-read'
import {
  FIXTURE_START,
  createTaskWindowHarness,
  record,
  seedCodexAttempt,
  settleAttempt,
  writeTranscript,
  type TaskWindowHarness
} from './task-window.test-fixture'

let harness: TaskWindowHarness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

function setup() {
  harness = createTaskWindowHarness()
  return harness
}

function read(h: TaskWindowHarness, dispatchId: string, fromByteOffset = 0, maxBytes = 262_144) {
  return readAttemptTranscript(
    { owner: h.owner, userDataPath: h.userDataPath },
    { dispatchId, fromByteOffset, maxBytes }
  )
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OrchestrationError) {
      return error.code
    }
    throw error
  }
  throw new Error('expected a refusal')
}

const MESSAGE = record('message', 1, { text: 'Reading the parser.' })
const END = record('end', 2, { state: 'completed', exitCode: 0, reasonCode: null })

describe('readAttemptTranscript', () => {
  it('returns whole lines from the offset and says the attempt is live', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    writeTranscript(runDir, FIXTURE_START + MESSAGE)

    const first = await read(h, dispatchId)
    expect(first).toMatchObject({
      chunk: FIXTURE_START + MESSAGE,
      nextByteOffset: Buffer.byteLength(FIXTURE_START + MESSAGE),
      reset: false,
      truncated: false,
      live: true,
      ended: false
    })
    expect(first.fileIdentity).toMatch(/^[0-9a-f]{32}$/)

    const again = await read(h, dispatchId, first.nextByteOffset)
    expect(again).toMatchObject({ chunk: '', nextByteOffset: first.nextByteOffset, reset: false })
  })

  it('holds back a line the writer has not finished while the attempt runs', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    writeTranscript(runDir, FIXTURE_START + MESSAGE.slice(0, 20))

    const result = await read(h, dispatchId)
    expect(result.chunk).toBe(FIXTURE_START)
    expect(result.nextByteOffset).toBe(Buffer.byteLength(FIXTURE_START))
  })

  it('stops at the last whole line inside maxBytes and continues from there', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    writeTranscript(runDir, FIXTURE_START + MESSAGE + END)

    const first = await read(h, dispatchId, 0, Buffer.byteLength(FIXTURE_START) + 10)
    expect(first.chunk).toBe(FIXTURE_START)
    expect(first.ended).toBe(false)
    const second = await read(h, dispatchId, first.nextByteOffset)
    expect(second.chunk).toBe(MESSAGE + END)
  })

  it('cuts an oversized line on a character boundary, never inside a UTF-8 sequence', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    const wide = record('message', 1, { text: '保留原始证据'.repeat(40) })
    writeTranscript(runDir, FIXTURE_START + wide)

    let offset = Buffer.byteLength(FIXTURE_START)
    let text = ''
    const total = offset + Buffer.byteLength(wide)
    for (let guard = 0; guard < 200 && offset < total; guard += 1) {
      const part = await read(h, dispatchId, offset, 7)
      expect(part.chunk).not.toContain('�')
      text += part.chunk
      offset = part.nextByteOffset
    }
    expect(text).toBe(wide)
  })

  it('reports ended only once a read reaches the end record, and not live after settling', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    writeTranscript(runDir, FIXTURE_START + MESSAGE + END)
    settleAttempt(h, dispatchId)

    const partial = await read(h, dispatchId, 0, Buffer.byteLength(FIXTURE_START))
    expect(partial).toMatchObject({ live: false, ended: false })
    const rest = await read(h, dispatchId, partial.nextByteOffset)
    expect(rest).toMatchObject({ chunk: MESSAGE + END, live: false, ended: true })
  })

  it('says the writer truncated the transcript, before and after the end record', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    const note = record('note', 1, { code: 'truncated' })
    writeTranscript(runDir, FIXTURE_START + note)
    expect(await read(h, dispatchId, 0, 64)).toMatchObject({ truncated: true, ended: false })

    writeTranscript(runDir, FIXTURE_START + note + END)
    expect(await read(h, dispatchId)).toMatchObject({ truncated: true, ended: true })
  })

  it('resets to the start when the offset is past the end of the file', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    writeTranscript(runDir, FIXTURE_START)

    expect(await read(h, dispatchId, 50_000)).toMatchObject({
      chunk: '',
      nextByteOffset: 0,
      reset: true
    })
  })

  it('reports a new file identity when the transcript is replaced', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    const path = writeTranscript(runDir, FIXTURE_START + MESSAGE)
    const before = await read(h, dispatchId)
    rmSync(path)
    await new Promise((resolve) => setTimeout(resolve, 20))
    writeTranscript(runDir, FIXTURE_START)

    const after = await read(h, dispatchId, before.nextByteOffset)
    expect(after.fileIdentity).not.toBe(before.fileIdentity)
    expect(after).toMatchObject({ reset: true, nextByteOffset: 0, chunk: '' })
  })

  it('waits for a live attempt whose transcript does not exist yet', async () => {
    const h = setup()
    const { dispatchId } = seedCodexAttempt(h)

    expect(await read(h, dispatchId)).toEqual({
      chunk: '',
      nextByteOffset: 0,
      fileIdentity: '',
      reset: false,
      truncated: false,
      live: true,
      ended: false
    })
  })

  it('refuses a settled attempt without a transcript and an unknown attempt', async () => {
    const h = setup()
    const { dispatchId } = seedCodexAttempt(h)
    settleAttempt(h, dispatchId, 'failed')

    expect(await refusal(read(h, dispatchId))).toBe('workbench_transcript_missing')
    expect(await refusal(read(h, 'ctx_000000000000'))).toBe('workbench_attempt_not_found')
  })

  it('refuses a run directory outside the runs root and never reads that file', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h, { runDirectory: 'elsewhere/run/ctx' })
    writeTranscript(runDir, FIXTURE_START)

    expect(await refusal(read(h, dispatchId))).toBe('workbench_transcript_refused')
  })

  it('refuses a transcript that is a link or not a regular file, even inside the runs root', async () => {
    const h = setup()
    const linked = seedCodexAttempt(h)
    const target = seedCodexAttempt(h)
    writeTranscript(target.runDir, FIXTURE_START)
    // Why a junction: Windows creates one without elevation, and lstat reports it as a link.
    symlinkSync(target.runDir, join(linked.runDir, 'transcript.jsonl'), 'junction')
    const directory = seedCodexAttempt(h)
    mkdirSync(join(directory.runDir, 'transcript.jsonl'))

    expect(await refusal(read(h, linked.dispatchId))).toBe('workbench_transcript_refused')
    expect(await refusal(read(h, directory.dispatchId))).toBe('workbench_transcript_refused')
    let fileLink = false
    try {
      symlinkSync(
        join(target.runDir, 'transcript.jsonl'),
        join(linked.runDir, 'other.jsonl'),
        'file'
      )
      rmSync(join(linked.runDir, 'transcript.jsonl'))
      symlinkSync(
        join(target.runDir, 'transcript.jsonl'),
        join(linked.runDir, 'transcript.jsonl'),
        'file'
      )
      fileLink = true
    } catch {
      // Why: creating a file link needs a privilege Windows grants only in developer mode.
    }
    if (fileLink) {
      expect(await refusal(read(h, linked.dispatchId))).toBe('workbench_transcript_refused')
    }
  })

  it('refuses a regular file that does not start like a transcript', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    writeTranscript(runDir, 'PRIVATE KEY material that is not a transcript\n')

    expect(await refusal(read(h, dispatchId))).toBe('workbench_transcript_refused')
  })

  it('refuses a run directory that links outside the runs root', async () => {
    const h = setup()
    const { dispatchId, runDir } = seedCodexAttempt(h)
    const outside = join(h.userDataPath, 'outside-target')
    mkdirSync(outside)
    writeFileSync(join(outside, 'transcript.jsonl'), FIXTURE_START)
    rmSync(runDir, { recursive: true })
    // Why a junction: Windows creates one without elevation; elsewhere it is a plain dir link.
    symlinkSync(outside, runDir, 'junction')

    expect(await refusal(read(h, dispatchId))).toBe('workbench_transcript_refused')
  })
})
