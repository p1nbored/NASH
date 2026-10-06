import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAttemptResultFile, RESULT_TEXT_MAX_BYTES } from './attempt-result-file'
import { fakeEvidence, fakeExecutor, sha256Of } from './task-validation.test-fixture'

describe('attempt result file', () => {
  let runDir: string
  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'c5-result-'))
  })
  afterEach(() => rmSync(runDir, { recursive: true, force: true }))

  it('reads the Codex last message when its hash matches the executor record', async () => {
    writeFileSync(join(runDir, 'last-message.txt'), 'Done.')
    expect(await readAttemptResultFile(fakeEvidence({ runDirectory: runDir }))).toEqual({
      status: 'ok',
      text: 'Done.',
      sha256: sha256Of('Done.'),
      bytes: 5
    })
  })

  it("reads agy's output file for an agy attempt", async () => {
    writeFileSync(join(runDir, 'output.txt'), 'Draft.')
    const executor = fakeExecutor({
      executorKind: 'agy_cli',
      lastMessage: { sha256: sha256Of('Draft.'), bytes: 6, secretLike: false }
    })
    expect(
      await readAttemptResultFile(fakeEvidence({ executor, runDirectory: runDir }))
    ).toMatchObject({ status: 'ok', text: 'Draft.' })
  })

  it("reads an agy answer past the old 4 MiB cap, up to the runner's 64 MiB ceiling (D-027)", async () => {
    expect(RESULT_TEXT_MAX_BYTES).toBe(64 * 1024 * 1024)
    const answer = 'Long answer line.\n'.repeat(300_000)
    writeFileSync(join(runDir, 'output.txt'), answer)
    const executor = fakeExecutor({
      executorKind: 'agy_cli',
      lastMessage: { sha256: sha256Of(answer), bytes: answer.length, secretLike: false }
    })
    expect(
      await readAttemptResultFile(fakeEvidence({ executor, runDirectory: runDir }))
    ).toMatchObject({ status: 'ok', bytes: answer.length })
  })

  it('refuses a result that changed since the executor recorded it', async () => {
    writeFileSync(join(runDir, 'last-message.txt'), 'Edited later.')
    expect(await readAttemptResultFile(fakeEvidence({ runDirectory: runDir }))).toEqual({
      status: 'changed'
    })
  })

  it('names why no result can be read', async () => {
    expect(await readAttemptResultFile(fakeEvidence({ executor: null }))).toEqual({
      status: 'no_process'
    })
    expect(await readAttemptResultFile(fakeEvidence({ runDirectory: null }))).toEqual({
      status: 'no_run_directory'
    })
    const unrecorded = fakeExecutor({ lastMessage: null })
    expect(
      await readAttemptResultFile(fakeEvidence({ executor: unrecorded, runDirectory: runDir }))
    ).toEqual({ status: 'not_recorded' })
    expect(await readAttemptResultFile(fakeEvidence({ runDirectory: runDir }))).toEqual({
      status: 'missing'
    })
  })
})
