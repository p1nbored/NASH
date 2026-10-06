import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkExecutorCompleted, checkOutputSchema } from './executor-checks'
import { fakeEvidence, fakeExecutor, sha256Of } from './task-validation.test-fixture'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } }
}

describe('executor_completed', () => {
  it('passes on the runner evidence: completed, exit code 0, a recorded result', () => {
    const result = checkExecutorCompleted(fakeEvidence())
    expect(result).toMatchObject({ kind: 'executor_completed', status: 'pass' })
    expect(result.evidence).toEqual([
      { kind: 'executor_result', ref: sha256Of('Done.') },
      { kind: 'attempt', ref: 'ctx_fixture' }
    ])
  })

  it('fails on a nonzero exit or a runner verdict other than completed', () => {
    expect(
      checkExecutorCompleted(fakeEvidence({ executor: fakeExecutor({ exitCode: 2 }) }))
    ).toMatchObject({ status: 'fail', note: 'The executor exited with code 2.' })
    const verdict = { status: 'failed' }
    expect(
      checkExecutorCompleted(fakeEvidence({ executor: fakeExecutor({ verdict }) }))
    ).toMatchObject({ status: 'fail' })
    expect(
      checkExecutorCompleted(fakeEvidence({ executor: fakeExecutor({ state: 'failed' }) }))
    ).toMatchObject({ status: 'fail' })
  })

  it('cannot decide without process evidence or while a process may still run', () => {
    expect(checkExecutorCompleted(fakeEvidence({ executor: null }))).toMatchObject({
      status: 'inconclusive',
      note: 'An in-session attempt has no process evidence to check.'
    })
    expect(
      checkExecutorCompleted(fakeEvidence({ executor: fakeExecutor({ treeVerdict: 'live' }) }))
    ).toMatchObject({ status: 'inconclusive' })
    expect(
      checkExecutorCompleted(fakeEvidence({ executor: fakeExecutor({ lastMessage: null }) }))
    ).toMatchObject({ status: 'inconclusive' })
    expect(
      checkExecutorCompleted(fakeEvidence({ executor: fakeExecutor({ verdict: null }) }))
    ).toMatchObject({
      status: 'inconclusive',
      note: 'The runner recorded no verdict for the attempt.'
    })
  })
})

describe('output_schema', () => {
  let runDir: string
  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'c5-schema-'))
  })
  afterEach(() => rmSync(runDir, { recursive: true, force: true }))

  function withResult(text: string) {
    writeFileSync(join(runDir, 'last-message.txt'), text)
    const executor = fakeExecutor({
      lastMessage: { sha256: sha256Of(text), bytes: Buffer.byteLength(text), secretLike: false }
    })
    return fakeEvidence({ executor, runDirectory: runDir })
  }

  it('passes when the recorded result matches the schema the TaskSpec names', async () => {
    const result = await checkOutputSchema(withResult('{"ok":true}'), SCHEMA)
    expect(result).toMatchObject({ kind: 'output_schema', status: 'pass' })
    expect(result.evidence).toEqual([{ kind: 'executor_result', ref: sha256Of('{"ok":true}') }])
  })

  it('fails when the result does not match, or there is no result', async () => {
    expect(await checkOutputSchema(withResult('{"ok":"yes"}'), SCHEMA)).toMatchObject({
      status: 'fail'
    })
    expect(await checkOutputSchema(withResult('not json'), SCHEMA)).toMatchObject({
      status: 'fail'
    })
    const empty = join(runDir, 'empty')
    mkdirSync(empty)
    expect(await checkOutputSchema(fakeEvidence({ runDirectory: empty }), SCHEMA)).toMatchObject({
      status: 'fail',
      note: 'The executor left no result to validate.'
    })
  })

  it('cannot decide for a schema it cannot enforce, a changed result, or a non-Codex attempt', async () => {
    expect(
      await checkOutputSchema(withResult('{"ok":true}'), { type: 'object', $ref: 'https://x' })
    ).toMatchObject({ status: 'inconclusive' })
    const evidence = withResult('{"ok":true}')
    writeFileSync(join(runDir, 'last-message.txt'), '{"ok":false}')
    expect(await checkOutputSchema(evidence, SCHEMA)).toMatchObject({ status: 'inconclusive' })
    expect(await checkOutputSchema(fakeEvidence({ executor: null }), SCHEMA)).toMatchObject({
      status: 'inconclusive',
      note: 'The output schema check applies to Codex attempts only.'
    })
    const agy = fakeEvidence({ executor: fakeExecutor({ executorKind: 'agy_cli' }) })
    expect(await checkOutputSchema(agy, SCHEMA)).toMatchObject({ status: 'inconclusive' })
  })
})
