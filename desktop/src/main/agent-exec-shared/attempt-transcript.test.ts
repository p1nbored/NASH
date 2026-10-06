// FIXTURE_ONLY: synthetic records and fake file handles; no CLI, model or credential is involved.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATTEMPT_TRANSCRIPT_FILE,
  attemptTranscriptPath,
  openAttemptTranscript,
  type AttemptTranscriptDeps,
  type TranscriptFileHandle
} from './attempt-transcript'
import { TRANSCRIPT_TRIMMED_MARKER, type TranscriptStart } from './attempt-transcript-records'

const START: TranscriptStart = {
  executor: 'codex',
  model: 'gpt-6-astra',
  effort: 'high',
  sandbox: 'read-only',
  cwd: 'C:/fixture/repo',
  worktree: null
}
const END = { state: 'completed', exitCode: 0, reasonCode: null } as const
const SECRET = 'sk-FIXTUREONLY1234567890abcdef'
const BASE_MS = Date.parse('2026-10-05T18:00:00.000Z')
const MIB = 1024 * 1024

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** `<root>/autopilot-runs/<run>/<attempt>`, as the runner leaves it before the child starts. */
function runDirectory(): { root: string; runDir: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'attempt-transcript-'))
  roots.push(root)
  const runDir = join(root, 'autopilot-runs', 'run_fixture', 'ctx_fixture')
  mkdirSync(runDir, { recursive: true })
  return { root, runDir, path: join(runDir, ATTEMPT_TRANSCRIPT_FILE) }
}

function ticking(): () => number {
  let tick = 0
  return () => BASE_MS + tick++
}

const quietRetention = async () => ({ deleted: 0, errors: 0 })

function open(
  path: string,
  runDir: string,
  deps: Partial<AttemptTranscriptDeps> = {}
): ReturnType<typeof openAttemptTranscript> {
  return openAttemptTranscript({
    path,
    runDir,
    platform: process.platform,
    start: START,
    deps: { now: ticking(), prune: quietRetention, ...deps }
  })
}

type MemoryFile = {
  readonly lines: () => Record<string, unknown>[]
  readonly text: () => string
  readonly deps: Pick<AttemptTranscriptDeps, 'open'>
}

/** An in-memory file whose writes settle at once, or when `gate` resolves. */
function memoryFile(gate: Promise<void> = Promise.resolve()): MemoryFile {
  const writes: string[] = []
  const handle: TranscriptFileHandle = {
    write: async (text) => {
      await gate
      writes.push(text)
    },
    close: async () => {}
  }
  const text = () => writes.join('')
  return {
    text,
    lines: () =>
      text()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line)),
    deps: { open: async () => handle }
  }
}

function readLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}

const FAKE_RUN_DIR = join('C:/fixture/runs/run_a', 'ctx_b')

/** A transcript on the fixture paths; the file itself is replaced by `deps.open`. */
function openFake(deps: Partial<AttemptTranscriptDeps>): ReturnType<typeof openAttemptTranscript> {
  return open(join(FAKE_RUN_DIR, ATTEMPT_TRANSCRIPT_FILE), FAKE_RUN_DIR, deps)
}

const nextMacrotask = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('attemptTranscriptPath', () => {
  it('names the transcript file inside the attempt run directory', () => {
    expect(attemptTranscriptPath('C:/fixture/userData/autopilot-runs/run_a', 'ctx_b')).toBe(
      join('C:/fixture/userData/autopilot-runs/run_a', 'ctx_b', 'transcript.jsonl')
    )
  })
})

describe('openAttemptTranscript on disk', () => {
  it('writes start first, then the records in order, then end, one JSON object per LF line', async () => {
    const { runDir, path } = runDirectory()
    const transcript = open(path, runDir)
    transcript.append({ kind: 'message', text: 'first' })
    transcript.append({ kind: 'output', stream: 'stderr', text: 'warning: second' })
    const outcome = await transcript.finish(END)

    const raw = readFileSync(path, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).not.toContain('\r')
    const lines = readLines(path)
    expect(lines.map((line) => line.kind)).toEqual(['start', 'message', 'output', 'end'])
    expect(lines.map((line) => line.seq)).toEqual([0, 1, 2, 3])
    expect(lines.every((line) => line.v === 1)).toBe(true)
    expect(lines[0]).toEqual({
      v: 1,
      seq: 0,
      at: '2026-10-05T18:00:00.000Z',
      kind: 'start',
      ...START
    })
    for (const line of lines) {
      expect(String(line.at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    }
    expect(Object.keys(lines[1] ?? {}).slice(0, 4)).toEqual(['v', 'seq', 'at', 'kind'])
    expect(lines[3]).toMatchObject({
      kind: 'end',
      state: 'completed',
      exitCode: 0,
      reasonCode: null
    })
    expect(outcome).toEqual({
      errorCode: null,
      errorCount: 0,
      droppedRecords: 0,
      truncated: false,
      retention: { deleted: 0, errors: 0 }
    })
  })

  it('creates the file exclusively and never writes through an existing one', async () => {
    const { runDir, path } = runDirectory()
    writeFileSync(path, 'planted')
    const transcript = open(path, runDir)
    transcript.append({ kind: 'message', text: 'never written' })
    const outcome = await transcript.finish(END)
    expect(readFileSync(path, 'utf8')).toBe('planted')
    expect(outcome).toMatchObject({ errorCode: 'transcript_open_failed', errorCount: 1 })
  })

  it.skipIf(process.platform === 'win32')('creates the file owner-only (0o600)', async () => {
    const { runDir, path } = runDirectory()
    await open(path, runDir).finish(END)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('refuses a path that is not transcript.jsonl in the run directory, creating nothing', async () => {
    const { root, runDir } = runDirectory()
    const elsewhere = join(root, ATTEMPT_TRANSCRIPT_FILE)
    const prune = vi.fn(quietRetention)
    const outcome = await open(elsewhere, runDir, { prune }).finish(END)
    expect(outcome).toMatchObject({ errorCode: 'transcript_path_invalid', errorCount: 1 })
    expect(() => statSync(elsewhere)).toThrow()
    expect(prune).not.toHaveBeenCalled()
    const wrongName = await open(join(runDir, 'other.jsonl'), runDir).finish(END)
    expect(wrongName.errorCode).toBe('transcript_path_invalid')
  })

  it('runs retention once at open over the runs root two levels above the run directory', async () => {
    const { root, runDir, path } = runDirectory()
    const prune = vi.fn(async () => ({ deleted: 3, errors: 1 }))
    const outcome = await open(path, runDir, { prune }).finish(END)
    expect(prune).toHaveBeenCalledTimes(1)
    expect(prune).toHaveBeenCalledWith(join(root, 'autopilot-runs'))
    expect(outcome.retention).toEqual({ deleted: 3, errors: 1 })
  })
})

describe('openAttemptTranscript redaction and caps', () => {
  it('redacts every text field, including the start fields', async () => {
    const file = memoryFile()
    const transcript = openAttemptTranscript({
      path: join(FAKE_RUN_DIR, ATTEMPT_TRANSCRIPT_FILE),
      runDir: FAKE_RUN_DIR,
      platform: process.platform,
      start: { ...START, cwd: `C:/fixture/${SECRET}` },
      deps: { now: ticking(), prune: quietRetention, ...file.deps }
    })
    transcript.append({ kind: 'message', text: `key ${SECRET}` })
    transcript.append({
      kind: 'command',
      id: 'item_1',
      status: 'completed',
      command: `curl -H "Authorization: Bearer ${SECRET}"`,
      exitCode: 0,
      output: `token=${SECRET}`
    })
    transcript.append({ kind: 'file_change', status: 'completed', paths: [`notes/${SECRET}.md`] })
    transcript.append({ kind: 'turn', phase: 'failed', usage: null, error: `bad ${SECRET}` })
    transcript.append({ kind: 'error', text: `api_key=${SECRET}` })
    transcript.append({ kind: 'output', stream: 'stdout', text: SECRET })
    await transcript.finish(END)
    expect(file.text()).not.toContain('FIXTUREONLY')
    expect(file.text()).toContain('[redacted]')
    expect(file.lines()).toHaveLength(8)
  })

  it('keeps every serialized record within 8 KiB, ending cut text with the trimmed marker', async () => {
    const file = memoryFile()
    const transcript = openFake(file.deps)
    const huge = 'a'.repeat(20_000)
    transcript.append({ kind: 'message', text: huge })
    transcript.append({ kind: 'output', stream: 'stdout', text: '\u754c'.repeat(6_000) })
    transcript.append({ kind: 'output', stream: 'stdout', text: '\u0001'.repeat(6_000) })
    transcript.append({
      kind: 'command',
      id: 'item_2',
      status: 'completed',
      command: 'b'.repeat(9_000),
      exitCode: 1,
      output: 'c'.repeat(4_000)
    })
    transcript.append({
      kind: 'file_change',
      status: 'completed',
      paths: Array.from({ length: 50 }, (_, index) => `${index}-${'p'.repeat(1_000)}`)
    })
    await transcript.finish(END)
    const rawLines = file.text().split('\n').slice(0, -1)
    expect(rawLines.length).toBe(7)
    for (const line of rawLines) {
      expect(Buffer.byteLength(`${line}\n`)).toBeLessThanOrEqual(8 * 1024)
    }
    const [, message, wide, control, command, change] = file.lines()
    expect(String(message?.text).endsWith(TRANSCRIPT_TRIMMED_MARKER)).toBe(true)
    expect(String(wide?.text).endsWith(TRANSCRIPT_TRIMMED_MARKER)).toBe(true)
    expect(String(control?.text).endsWith(TRANSCRIPT_TRIMMED_MARKER)).toBe(true)
    expect(String(command?.command).endsWith(TRANSCRIPT_TRIMMED_MARKER)).toBe(true)
    expect(change?.paths).toHaveLength(50)
  })

  it('stops at 8 MiB with one truncated note, keeping the start and still writing end', async () => {
    const file = memoryFile()
    const transcript = openFake(file.deps)
    const text = 'z'.repeat(7_900)
    for (let batch = 0; batch < 3; batch += 1) {
      for (let index = 0; index < 500; index += 1) {
        transcript.append({ kind: 'output', stream: 'stdout', text })
      }
      await nextMacrotask()
    }
    const outcome = await transcript.finish({
      state: 'failed',
      exitCode: 1,
      reasonCode: 'nonzero_exit'
    })

    const raw = file.text()
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(8 * MIB)
    const lines = file.lines()
    expect(lines[0]?.kind).toBe('start')
    expect(lines.filter((line) => line.kind === 'note')).toEqual([
      expect.objectContaining({ code: 'truncated' })
    ])
    expect(lines.at(-2)).toMatchObject({ kind: 'note', code: 'truncated' })
    expect(lines.at(-1)).toMatchObject({ kind: 'end', state: 'failed', reasonCode: 'nonzero_exit' })
    expect(lines.map((line) => line.seq)).toEqual(lines.map((_, index) => index))
    const beforeEnd = raw.slice(0, raw.lastIndexOf('{"v":1'))
    expect(Buffer.byteLength(beforeEnd)).toBeLessThanOrEqual(8 * MIB - 4 * 1024)
    expect(outcome).toMatchObject({ truncated: true, errorCode: null, droppedRecords: 0 })
  })
})

describe('openAttemptTranscript queue', () => {
  it('drops records past 1,000 queued, counts them and writes the count before end', async () => {
    let release: () => void = () => {}
    const file = memoryFile(new Promise<void>((resolve) => (release = resolve)))
    const transcript = openFake(file.deps)
    for (let index = 0; index < 1_499; index += 1) {
      transcript.append({ kind: 'output', stream: 'stdout', text: `line ${index}` })
    }
    release()
    const outcome = await transcript.finish(END)
    const lines = file.lines()
    expect(outcome.droppedRecords).toBe(500)
    expect(lines).toHaveLength(1 + 999 + 1 + 1)
    expect(lines.at(-2)).toMatchObject({ kind: 'note', code: 'records_dropped', count: 500 })
    expect(lines.at(-1)?.kind).toBe('end')
    expect(lines.map((line) => line.seq)).toEqual(lines.map((_, index) => index))
  })

  it('writes the dropped count where the gap was once the queue has room again', async () => {
    let release: () => void = () => {}
    const file = memoryFile(new Promise<void>((resolve) => (release = resolve)))
    const transcript = openFake(file.deps)
    for (let index = 0; index < 1_010; index += 1) {
      transcript.append({ kind: 'output', stream: 'stdout', text: `burst ${index}` })
    }
    release()
    await nextMacrotask()
    transcript.append({ kind: 'message', text: 'after the burst' })
    const outcome = await transcript.finish(END)
    const lines = file.lines()
    expect(outcome.droppedRecords).toBe(11)
    expect(lines.slice(-3)).toEqual([
      expect.objectContaining({ kind: 'note', code: 'records_dropped', count: 11 }),
      expect.objectContaining({ kind: 'message', text: 'after the burst' }),
      expect.objectContaining({ kind: 'end' })
    ])
  })

  it('never throws or waits in append, and ignores records after finish', async () => {
    const file = memoryFile()
    const transcript = openFake(file.deps)
    const first = transcript.finish(END)
    expect(() => transcript.append({ kind: 'message', text: 'late' })).not.toThrow()
    const outcome = await first
    await expect(transcript.finish(END)).resolves.toEqual(outcome)
    expect(file.lines().map((line) => line.kind)).toEqual(['start', 'end'])
  })
})

describe('openAttemptTranscript failures', () => {
  it('counts a failed write as a code and still resolves finish', async () => {
    const handle: TranscriptFileHandle = {
      write: async () => {
        throw Object.assign(new Error(`disk full at C:/private/${SECRET}`), { code: 'ENOSPC' })
      },
      close: async () => {}
    }
    const transcript = openFake({
      open: async () => handle
    })
    transcript.append({ kind: 'message', text: 'lost' })
    const outcome = await transcript.finish(END)
    expect(outcome.errorCode).toBe('transcript_write_failed')
    expect(outcome.errorCount).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(outcome)).not.toContain('FIXTUREONLY')
  })

  it('counts a failed open and a failed close', async () => {
    const refused = await openFake({
      open: async () => {
        throw new Error('EACCES')
      }
    }).finish(END)
    expect(refused).toMatchObject({ errorCode: 'transcript_open_failed', errorCount: 1 })
    const closing = await openFake({
      open: async () => ({
        write: async () => {},
        close: async () => {
          throw new Error('EIO')
        }
      })
    }).finish(END)
    expect(closing).toMatchObject({ errorCode: 'transcript_close_failed', errorCount: 1 })
  })

  it('stops waiting at the flush timeout so a stuck disk never holds the run', async () => {
    const stuck: TranscriptFileHandle = {
      write: () => new Promise(() => {}),
      close: async () => {}
    }
    const transcript = openFake({
      open: async () => stuck,
      flushTimeoutMs: 50
    })
    const started = performance.now()
    const outcome = await transcript.finish(END)
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(outcome.errorCode).toBe('transcript_flush_timeout')
  })
})
