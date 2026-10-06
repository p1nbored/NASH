// FIXTURE_ONLY: synthetic results in a temporary data folder; the secret below is an obviously fake shape.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { readAttemptResult } from './executor-result-view'
import {
  AGY_ROUTE,
  CODEX_ROUTE,
  SUBAGENT_ROUTE,
  createAppRunHarness,
  seedRoutedAppTask,
  type AppRunHarness,
  type RouteFixture
} from './task-execution.test-fixture'

const FAKE_SECRET = 'sk-FIXTUREFIXTUREFIXTURE000'

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

describe('readAttemptResult', () => {
  let harness: AppRunHarness
  let userData: string

  beforeEach(() => {
    harness = createAppRunHarness()
    userData = mkdtempSync(join(tmpdir(), 'task-result-view-'))
  })
  afterEach(() => {
    harness.owner.close()
    rmSync(userData, { recursive: true, force: true })
  })

  function claimedAttempt(route: RouteFixture, text: string, recordedText = text): string {
    const settlement = getAppAttemptSettlement(harness.owner)
    const { taskId, routeId } = seedRoutedAppTask(harness, route)
    const executor = route.target === 'agy_cli' ? 'agy_cli' : 'codex_cli'
    const { dispatchId } = settlement.start({
      taskId,
      routeId,
      executor,
      creator: { kind: 'system' },
      maxDepth: 4,
      timestamp: fixtureTime(10)
    })
    settlement.markRunning({
      dispatchId,
      executableEvidence: { executor, entryFile: 'fixture-cli' },
      timestamp: fixtureTime(11)
    })
    settlement.settleClaim({
      dispatchId,
      exitCode: 0,
      tree: { verdict: 'unverifiable', method: 'root_exit_only' },
      lastMessage: {
        sha256: sha256(recordedText),
        bytes: Buffer.byteLength(recordedText),
        secretLike: true
      },
      timestamp: fixtureTime(12)
    })
    const runDir = join(userData, 'autopilot-runs', harness.runId, dispatchId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, executor === 'agy_cli' ? 'output.txt' : 'last-message.txt'), text)
    return dispatchId
  }

  it('shows a Codex result masked and bounded, with its recorded evidence', async () => {
    const text = `Result line.\nKey: ${FAKE_SECRET}\n${'x'.repeat(200)}`
    const dispatchId = claimedAttempt(CODEX_ROUTE, text)
    const view = await readAttemptResult(
      { owner: harness.owner, userDataPath: userData, maxChars: 80 },
      dispatchId
    )
    expect(view).toMatchObject({
      state: 'ok',
      truncated: true,
      secretLike: true,
      sha256: sha256(text)
    })
    expect(view.state === 'ok' ? view.text : '').not.toContain(FAKE_SECRET)
    expect(view.state === 'ok' ? view.text.length : 0).toBeLessThanOrEqual(80)
  })

  it('reads the agy answer from its own output file', async () => {
    const dispatchId = claimedAttempt(AGY_ROUTE, 'An alternative draft.')
    await expect(
      readAttemptResult({ owner: harness.owner, userDataPath: userData }, dispatchId)
    ).resolves.toMatchObject({ state: 'ok', text: 'An alternative draft.', truncated: false })
  })

  it('refuses a file that no longer matches the recorded hash', async () => {
    const dispatchId = claimedAttempt(CODEX_ROUTE, 'Changed afterwards.', 'Original text.')
    await expect(
      readAttemptResult({ owner: harness.owner, userDataPath: userData }, dispatchId)
    ).resolves.toEqual({ state: 'changed' })
  })

  it('refuses a file of the recorded size whose bytes changed', async () => {
    const dispatchId = claimedAttempt(CODEX_ROUTE, 'Edited text!', 'Stored text!')
    await expect(
      readAttemptResult({ owner: harness.owner, userDataPath: userData }, dispatchId)
    ).resolves.toEqual({ state: 'changed' })
  })

  it('has no result for an attempt without a process or without recorded output', async () => {
    const { taskId, routeId } = seedRoutedAppTask(harness, SUBAGENT_ROUTE)
    const { dispatchId } = getAppAttemptSettlement(harness.owner).start({
      taskId,
      routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: 4,
      timestamp: fixtureTime(10)
    })
    await expect(
      readAttemptResult({ owner: harness.owner, userDataPath: userData }, dispatchId)
    ).resolves.toEqual({ state: 'no_result' })
    await expect(
      readAttemptResult({ owner: harness.owner, userDataPath: userData }, 'ctx_unknown00001')
    ).resolves.toEqual({ state: 'no_result' })
  })
})
