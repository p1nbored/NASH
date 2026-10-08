import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { DOT_ALLOW_READ_TOOLS, DOT_ALLOW_REFUSED_CODE, dotMayAllow } from './permission-dot-allow'
import {
  FIXTURE_EVIDENCE,
  FIXTURE_START_MS,
  createRelayHarness,
  relayRequest,
  type RelayHarness
} from './permission-relay.test-fixture'

// RG7: a read-only run denies Edit, Write and NotebookEdit but cannot stop a shell command from
// writing, so dot may only deny a command or edit prompt there; it may allow one on a write run.

const PROMPTS = {
  Bash: { toolName: 'Bash', toolInput: { command: 'git status' } },
  PowerShell: { toolName: 'PowerShell', toolInput: { command: 'Get-ChildItem' } },
  Monitor: { toolName: 'Monitor', toolInput: { command: 'tail -f build.log' } },
  Edit: { toolName: 'Edit', toolInput: { file_path: '/fixture/repo/src/a.ts' } },
  Write: { toolName: 'Write', toolInput: { file_path: '/fixture/repo/src/b.ts' } },
  NotebookEdit: { toolName: 'NotebookEdit', toolInput: { notebook_path: '/fixture/repo/n.ipynb' } },
  Read: { toolName: 'Read', toolInput: { file_path: '/fixture/repo/docs/plan.md' } },
  Glob: { toolName: 'Glob', toolInput: { pattern: 'src/**/*.ts' } }
} as const
type PromptName = keyof typeof PROMPTS
const WRITING_PROMPTS: readonly PromptName[] = [
  'Bash',
  'PowerShell',
  'Monitor',
  'Edit',
  'Write',
  'NotebookEdit'
]
const READING_PROMPTS: readonly PromptName[] = ['Read', 'Glob']

function codeOf(operation: () => unknown): string | null {
  try {
    operation()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : `unexpected: ${String(error)}`
  }
}

function relayed(harness: RelayHarness, prompt: PromptName): string {
  const result = harness.service.request(FIXTURE_EVIDENCE, relayRequest(PROMPTS[prompt]))
  if (result.outcome !== 'relayed') {
    throw new Error(`expected ${prompt} to be relayed`)
  }
  return result.decisionId
}

// FIXTURE_ONLY: the seeded run is read-only; this flips its recorded access for the write-run cases.
function makeRunWritable(harness: RelayHarness): void {
  harness.owner.db
    .prepare("UPDATE workflow_runs SET requested_access = 'workspace_write' WHERE run_id = ?")
    .run('run_fixture01')
}

describe('permission relay: what dot may allow depends on the run access (RG7)', () => {
  let harness: RelayHarness

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    harness = createRelayHarness()
  })
  afterEach(() => {
    harness.service.dispose()
    harness.owner.close()
    vi.useRealTimers()
  })

  it('treats only the read tools as allowable on a run that may not write', () => {
    expect([...DOT_ALLOW_READ_TOOLS]).toEqual(['Read', 'Glob'])
  })

  it('offers Grep for user escalation while refusing dot approval', () => {
    const result = harness.service.request(
      FIXTURE_EVIDENCE,
      relayRequest({ toolName: 'Grep', toolInput: { path: '/fixture/repo/src', pattern: 'x' } })
    )
    const id = result.outcome === 'relayed' ? result.decisionId : 'missing'
    void harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    expect(
      harness.service.listForDot('run_fixture01', { limit: 10 }).map((record) => record.decisionId)
    ).toEqual([id])
    expect(codeOf(() => harness.service.answerFromDot({ decisionId: id, decision: 'allow' }))).toBe(
      'autopilot_permission_desktop_only'
    )
  })

  it.each(WRITING_PROMPTS)(
    'refuses a dot allow of a %s prompt on a read-only run, with no effect',
    async (prompt) => {
      const id = relayed(harness, prompt)
      const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 2_000 })
      expect(
        codeOf(() => harness.service.answerFromDot({ decisionId: id, decision: 'allow' }))
      ).toBe(DOT_ALLOW_REFUSED_CODE)
      expect(harness.store.get(id)?.status).toBe('pending')
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(waiting).resolves.toEqual({ state: 'pending' })
    }
  )

  it.each(WRITING_PROMPTS)('lets dot deny a %s prompt on a read-only run', async (prompt) => {
    const id = relayed(harness, prompt)
    const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    expect(harness.service.answerFromDot({ decisionId: id, decision: 'deny' })).toMatchObject({
      outcome: 'decided',
      record: { status: 'denied', decidedBy: 'dot' }
    })
    await expect(waiting).resolves.toMatchObject({
      state: 'decided',
      hookOutput: { hookSpecificOutput: { decision: { behavior: 'deny' } } }
    })
  })

  it.each(READING_PROMPTS)('lets dot allow a %s prompt on a read-only run', (prompt) => {
    const id = relayed(harness, prompt)
    void harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    expect(harness.service.answerFromDot({ decisionId: id, decision: 'allow' })).toMatchObject({
      outcome: 'decided',
      record: { status: 'allowed', decidedBy: 'dot' }
    })
  })

  it.each(WRITING_PROMPTS)('lets dot allow a %s prompt on a run that may write', (prompt) => {
    makeRunWritable(harness)
    const id = relayed(harness, prompt)
    void harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    expect(harness.service.answerFromDot({ decisionId: id, decision: 'allow' })).toMatchObject({
      outcome: 'decided',
      record: { status: 'allowed', decidedBy: 'dot' }
    })
  })

  it('applies the same rule however the dot answer reaches the relay', () => {
    const id = relayed(harness, 'Bash')
    void harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    expect(
      codeOf(() => harness.service.answer({ decisionId: id, decision: 'allow', decidedBy: 'dot' }))
    ).toBe(DOT_ALLOW_REFUSED_CODE)
    expect(harness.store.get(id)?.status).toBe('pending')
  })

  it('leaves the desktop free to allow a command on a read-only run', () => {
    const id = relayed(harness, 'Bash')
    void harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    expect(harness.service.answerFromDesktop({ decisionId: id, decision: 'allow' })).toMatchObject({
      outcome: 'decided',
      decision: { status: 'allowed', decidedBy: 'desktop' }
    })
  })

  it('says why in the refusal, without any prompt text', () => {
    const id = relayed(harness, 'Bash')
    void harness.service.wait(FIXTURE_EVIDENCE, { decisionId: id, waitMs: 20_000 })
    try {
      harness.service.answerFromDot({ decisionId: id, decision: 'allow' })
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(OrchestrationError)
      const refusal = error instanceof OrchestrationError ? error : null
      expect(refusal?.data).toEqual({ effectsApplied: false, reason: 'run_read_only' })
      expect(refusal?.message).not.toContain('git status')
    }
  })

  it('reports dotMayAllow from the tool and the recorded run access', () => {
    const bash = harness.store.get(relayed(harness, 'Bash'))
    const read = harness.store.get(relayed(harness, 'Read'))
    if (!bash || !read) {
      throw new Error('expected stored prompts')
    }
    expect(dotMayAllow(harness.owner, bash)).toBe(false)
    expect(dotMayAllow(harness.owner, read)).toBe(true)
    // Fail closed: a tool not known to only read needs a run that may write.
    expect(dotMayAllow(harness.owner, { runId: 'run_fixture01', toolName: 'FutureTool' })).toBe(
      false
    )
    makeRunWritable(harness)
    expect(dotMayAllow(harness.owner, bash)).toBe(true)
    expect(dotMayAllow(harness.owner, { runId: 'run_missing', toolName: 'Bash' })).toBe(false)
    expect(dotMayAllow(harness.owner, { runId: 'run_fixture01', toolName: 'FutureTool' })).toBe(
      true
    )
  })
})
