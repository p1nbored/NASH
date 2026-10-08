import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import type { HandlerContext } from '../dispatch'
import { RuntimeClientError } from '../runtime/types'
import { DOT_COMMAND_SPECS } from '../specs/dot'
import { DOT_HANDLERS, createDotHandlers, type DotCliDeps } from './dot'

// FIXTURE_ONLY: ids, paths, the token and the endpoint below are synthetic.
const METADATA: RuntimeMetadata = {
  runtimeId: 'runtime-fixture-1',
  pid: 4242,
  startedAt: 1,
  authToken: '0123456789abcdef'.repeat(4),
  transports: [{ kind: 'named-pipe', endpoint: '\\\\.\\pipe\\orca-4242-fixture-dot' }]
}
const REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const GENERATED_ID = '00000000-0000-4000-8000-0000000000aa'
const WORKSPACE_REF = `dws_${'a'.repeat(24)}`
const OBJECTIVE = 'Summarize the open issues in `docs/plan.md`.'

function requestView(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 3,
    dotRequestId: REQUEST_ID,
    sequence: 1,
    revision: 2,
    workspaceRef: WORKSPACE_REF,
    reply: null,
    createdAt: '2026-10-05T00:00:10.000Z',
    updatedAt: '2026-10-05T00:00:10.000Z',
    result: null,
    artifacts: [],
    state: 'submitted',
    statusText: 'The request was handed to the workbench and starts without further confirmation.',
    run: { state: 'active', blocker: null },
    requestedAccess: 'read_only',
    ...overrides
  }
}

function harness(results: Record<string, unknown> = {}) {
  const printed: string[] = []
  const files = new Map<string, string>([[resolve('/fixture/cwd', 'objective.txt'), OBJECTIVE]])
  const send = vi.fn(
    async (_metadata: RuntimeMetadata, method: string, _params: unknown, _timeoutMs: number) => ({
      id: 'r1',
      ok: true as const,
      result: results[method] ?? { contractVersion: 3, request: requestView(), duplicate: false },
      _meta: { runtimeId: 'runtime-fixture-1' }
    })
  )
  const deps: DotCliDeps = {
    userDataPath: () => '/fixture/user-data',
    readMetadata: vi.fn(() => METADATA),
    send,
    readTextFile: (path) => {
      const text = files.get(path)
      if (text === undefined) {
        throw new Error(`ENOENT ${path}`)
      }
      return text
    },
    readStdin: async () => 'Summarize the issues from stdin.',
    newId: () => GENERATED_ID,
    print: (text) => printed.push(text)
  }
  const handlers = createDotHandlers(deps)
  const run = (command: string, flags: Record<string, string | boolean>, json = false) => {
    const handler = handlers[command]
    if (!handler) {
      throw new Error(`no handler ${command}`)
    }
    const ctx: HandlerContext = {
      flags: new Map(Object.entries(flags)),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: dot handlers never use the main runtime client.
      client: {} as never,
      cwd: '/fixture/cwd',
      json
    }
    return handler(ctx)
  }
  return { deps, send, printed, run, files }
}

describe('orca dot commands', () => {
  it('has one hidden spec per handler and no flag that carries text on the command line', () => {
    const specKeys = DOT_COMMAND_SPECS.map((spec) => spec.path.join(' ')).sort()
    expect(specKeys).toEqual(Object.keys(DOT_HANDLERS).sort())
    for (const spec of DOT_COMMAND_SPECS) {
      expect(spec.hidden, spec.path.join(' ')).toBe(true)
      expect(spec.path[0]).toBe('dot')
      expect(spec.allowedFlags).not.toContain('objective')
      expect(spec.allowedFlags).not.toContain('text')
      expect(spec.allowedFlags).not.toContain('language')
    }
  })

  it('submits the objective read from a file, with the given key and access', async () => {
    const { send, run, printed } = harness()
    await run('dot submit', {
      workspace: WORKSPACE_REF,
      'objective-file': 'objective.txt',
      'idempotency-key': REQUEST_ID,
      access: 'read_only'
    })
    expect(send).toHaveBeenCalledWith(
      METADATA,
      'dotIngress.requests.submit',
      {
        contractVersion: 3,
        workspaceRef: WORKSPACE_REF,
        objective: OBJECTIVE,
        idempotencyKey: REQUEST_ID,
        requestedAccess: 'read_only'
      },
      expect.any(Number)
    )
    expect(printed.join('\n')).toContain(`Request ${REQUEST_ID}: submitted`)
  })

  it('reads the objective from stdin with -, and prints a generated key so a retry can reuse it', async () => {
    const { send, run, printed } = harness()
    await run('dot submit', { workspace: WORKSPACE_REF, 'objective-file': '-' })
    expect(send.mock.calls[0]?.[2]).toMatchObject({
      objective: 'Summarize the issues from stdin.',
      idempotencyKey: GENERATED_ID
    })
    expect(printed.join('\n')).toContain(GENERATED_ID)
  })

  it.each([
    ['no objective file', { workspace: WORKSPACE_REF }],
    [
      'an unknown access level',
      { workspace: WORKSPACE_REF, 'objective-file': '-', access: 'root' }
    ],
    ['no workspace', { 'objective-file': '-' }]
  ])('refuses a submit with %s before calling the app', async (_name, flags) => {
    const { send, run } = harness()
    await expect(run('dot submit', flags)).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses an empty objective file', async () => {
    const { send, run, files } = harness()
    files.set(resolve('/fixture/cwd', 'empty.txt'), '')
    await expect(
      run('dot submit', { workspace: WORKSPACE_REF, 'objective-file': 'empty.txt' })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(send).not.toHaveBeenCalled()
  })

  it('prints the contract result as JSON when asked', async () => {
    const status = { contractVersion: 3, request: requestView() }
    const { run, printed } = harness({ 'dotIngress.requests.status': status })
    await run('dot status', { request: REQUEST_ID }, true)
    expect(JSON.parse(printed.join('\n'))).toEqual(status)
  })

  it('answers a prompt only with allow or deny', async () => {
    const { send, run } = harness()
    await expect(
      run('dot decide', { decision: REQUEST_ID, answer: 'approve' })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends a follow-up message read from a file, with a generated message id', async () => {
    const message = {
      contractVersion: 3,
      dotRequestId: REQUEST_ID,
      messageId: GENERATED_ID,
      outcome: 'queued',
      reason: 'agent_busy',
      duplicate: false
    }
    const { send, run, printed, files } = harness({ 'dotIngress.requests.message': message })
    files.set(resolve('/fixture/cwd', 'note.txt'), 'Also list the owners.')
    await run('dot message', { request: REQUEST_ID, 'text-file': 'note.txt' })
    expect(send.mock.calls[0]?.[2]).toEqual({
      contractVersion: 3,
      dotRequestId: REQUEST_ID,
      messageId: GENERATED_ID,
      text: 'Also list the owners.'
    })
    expect(printed.join('\n')).toContain('queued (agent_busy)')
  })

  it('lists waiting validation decisions of dot runs, optionally for one request', async () => {
    const listed = {
      contractVersion: 3,
      validations: [
        {
          validationId: 'validation_fixture_1',
          dotRequestId: REQUEST_ID,
          title: 'Summarize the open issues',
          reason: 'primary_did_task',
          summary: null,
          summaryWithheld: true,
          createdAt: '2026-10-06T08:00:00.000Z'
        }
      ],
      hasMore: true
    }
    const { send, run, printed } = harness({ 'dotIngress.validations.list': listed })
    await run('dot validations', { request: REQUEST_ID, limit: '5' })
    expect(send).toHaveBeenCalledWith(
      METADATA,
      'dotIngress.validations.list',
      { contractVersion: 3, dotRequestId: REQUEST_ID, limit: 5 },
      expect.any(Number)
    )
    const text = printed.join('\n')
    expect(text).toContain('validation_fixture_1')
    expect(text).toContain('primary_did_task')
    expect(text).toContain('summary withheld')
    expect(text).toContain('More decisions are waiting')
  })

  it('waives or rejects with a generated decision id it prints for a retry', async () => {
    const decided = {
      contractVersion: 3,
      decisionId: GENERATED_ID,
      validationId: 'validation_fixture_1',
      dotRequestId: REQUEST_ID,
      outcome: 'already_decided',
      decidedAt: '2026-10-06T08:00:00.000Z',
      duplicate: false
    }
    const { send, run, printed } = harness({ 'dotIngress.validations.decide': decided })
    await run('dot validation-decide', { validation: 'validation_fixture_1', answer: 'reject' })
    expect(send.mock.calls[0]?.[2]).toEqual({
      contractVersion: 3,
      decisionId: GENERATED_ID,
      validationId: 'validation_fixture_1',
      decision: 'reject'
    })
    const text = printed.join('\n')
    expect(text).toContain('already_decided')
    expect(text).toContain(`Decision id: ${GENERATED_ID}`)
  })

  it('decides a validation only with waive or reject, and reuses a given decision id', async () => {
    const { send, run } = harness()
    await expect(
      run('dot validation-decide', { validation: 'validation_fixture_1', answer: 'allow' })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(send).not.toHaveBeenCalled()
    const reused = harness({
      'dotIngress.validations.decide': {
        contractVersion: 3,
        decisionId: REQUEST_ID,
        validationId: 'validation_fixture_1',
        dotRequestId: REQUEST_ID,
        outcome: 'decided',
        decidedAt: '2026-10-06T08:00:00.000Z',
        duplicate: true
      }
    })
    await reused.run('dot validation-decide', {
      validation: 'validation_fixture_1',
      answer: 'waive',
      'decision-id': REQUEST_ID
    })
    expect(reused.send.mock.calls[0]?.[2]).toMatchObject({
      decisionId: REQUEST_ID,
      decision: 'waive'
    })
    expect(reused.printed.join('\n')).toContain('decided before')
  })

  it('reports a switched-off interface without calling anything', async () => {
    const { deps, send, run } = harness()
    deps.readMetadata = () => {
      throw new RuntimeClientError(
        'dot_ingress_disabled',
        'The dot interface is turned off in the app.'
      )
    }
    await expect(run('dot hello', {})).rejects.toMatchObject({ code: 'dot_ingress_disabled' })
    expect(send).not.toHaveBeenCalled()
  })
})
