// FIXTURE_ONLY: synthetic transcript files in a private temp folder; nothing else is touched.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_TRANSCRIPT_DELETIONS_PER_PASS,
  TRANSCRIPT_RETENTION_MS,
  pruneSettledTranscripts
} from './attempt-transcript-retention'

const NOW = Date.parse('2026-10-05T18:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const HEADER = '{"v":1,"seq":0,"at":"2026-08-01T00:00:00.000Z","kind":"start","executor":"codex"}\n'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function runsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'transcript-retention-'))
  roots.push(root)
  return root
}

function age(path: string, days: number): string {
  const seconds = (NOW - days * DAY) / 1000
  utimesSync(path, seconds, seconds)
  return path
}

function file(path: string, days: number, content = HEADER): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return age(path, days)
}

function transcript(root: string, run: string, attempt: string, days: number): string {
  return file(join(root, run, attempt, 'transcript.jsonl'), days)
}

const prune = (root: string) => pruneSettledTranscripts({ root, nowMs: NOW })

describe('pruneSettledTranscripts', () => {
  it('keeps transcripts for 30 days and deletes the ones settled earlier', async () => {
    const root = runsRoot()
    const old = transcript(root, 'run_a', 'ctx_old', 31)
    const recent = transcript(root, 'run_a', 'ctx_recent', 29)
    await expect(prune(root)).resolves.toEqual({ deleted: 1, errors: 0 })
    expect(existsSync(old)).toBe(false)
    expect(existsSync(join(root, 'run_a', 'ctx_old'))).toBe(true)
    expect(existsSync(recent)).toBe(true)
    expect(TRANSCRIPT_RETENTION_MS).toBe(30 * DAY)
  })

  it('deletes nothing but transcript.jsonl files of attempts, written by the transcript writer', async () => {
    const root = runsRoot()
    const kept = [
      file(join(root, 'run_a', 'ctx_1', 'last-message.txt'), 90),
      file(join(root, 'run_a', 'ctx_1', 'output.txt'), 90),
      file(join(root, 'run_a', 'ctx_2', 'transcript.jsonl'), 90, 'not a transcript\n'),
      file(join(root, 'transcript.jsonl'), 90),
      file(join(root, 'run_a', 'transcript.jsonl'), 90),
      file(join(root, 'run_a', 'ctx_3', 'nested', 'transcript.jsonl'), 90)
    ]
    const folder = join(root, 'run_a', 'ctx_4', 'transcript.jsonl')
    mkdirSync(folder, { recursive: true })
    age(folder, 90)
    await expect(prune(root)).resolves.toEqual({ deleted: 0, errors: 0 })
    for (const path of [...kept, folder]) {
      expect(existsSync(path), path).toBe(true)
    }
  })

  it.skipIf(process.platform === 'win32')(
    'never follows a link to a run or a transcript',
    async () => {
      const root = runsRoot()
      const outside = runsRoot()
      const target = transcript(outside, 'run_x', 'ctx_x', 90)
      symlinkSync(join(outside, 'run_x'), join(root, 'run_link'))
      mkdirSync(join(root, 'run_b', 'ctx_b'), { recursive: true })
      symlinkSync(target, join(root, 'run_b', 'ctx_b', 'transcript.jsonl'))
      await expect(prune(root)).resolves.toEqual({ deleted: 0, errors: 0 })
      expect(existsSync(target)).toBe(true)
    }
  )

  it('deletes at most 50 per pass and the rest on the next pass', async () => {
    const root = runsRoot()
    for (let index = 0; index < 60; index += 1) {
      transcript(root, `run_${index % 3}`, `ctx_${index}`, 45)
    }
    expect(MAX_TRANSCRIPT_DELETIONS_PER_PASS).toBe(50)
    await expect(prune(root)).resolves.toEqual({ deleted: 50, errors: 0 })
    await expect(prune(root)).resolves.toEqual({ deleted: 10, errors: 0 })
    await expect(prune(root)).resolves.toEqual({ deleted: 0, errors: 0 })
  })

  it('treats a missing runs root as nothing to do', async () => {
    const root = join(runsRoot(), 'absent')
    await expect(prune(root)).resolves.toEqual({ deleted: 0, errors: 0 })
  })

  it('counts a deletion that fails and keeps going', async () => {
    const root = runsRoot()
    transcript(root, 'run_a', 'ctx_1', 40)
    transcript(root, 'run_a', 'ctx_2', 40)
    let calls = 0
    const result = await pruneSettledTranscripts({
      root,
      nowMs: NOW,
      unlink: async () => {
        calls += 1
        if (calls === 1) {
          throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        }
      }
    })
    expect(result).toEqual({ deleted: 1, errors: 1 })
  })
})
