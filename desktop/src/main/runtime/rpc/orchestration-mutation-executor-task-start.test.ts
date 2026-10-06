import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { RpcRequest } from './core'
import {
  OrchestrationMutationExecutor,
  type DurableMutationInvocation
} from './orchestration-mutation-executor'

// D1's task-start hands the receipt identity to createStartingWorkerDispatch, which inserts the
// pending receipt in its own transaction and refuses one that already exists. So the executor must
// accept task-start atomically, as it does worker-start, instead of opening the receipt first.

const params = { taskId: 'task_0123456789ab' }

function taskStartRequest(requestId: string): RpcRequest {
  return {
    id: `rpc-${requestId}`,
    authToken: 'token',
    method: 'orchestration.taskStart',
    orchestrationRequestId: requestId,
    params
  }
}

function harness() {
  const db = new OrchestrationDb(':memory:')
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  return { db, executor: new OrchestrationMutationExecutor(runtime) }
}

/** What createStartingWorkerDispatch does with the identity: refuse an existing receipt, else insert it. */
function startingDispatch(db: OrchestrationDb, gate: Promise<void> = Promise.resolve()) {
  return vi.fn(async (mutation?: DurableMutationInvocation) => {
    if (!mutation) {
      throw new Error('task-start must receive the receipt identity')
    }
    const { callerFingerprint, requestId } = mutation.identity
    if (db.getMutationReceipt(callerFingerprint, requestId)) {
      throw new OrchestrationError(
        'operation_unknown',
        `Mutation ${requestId} already has a durable acceptance record.`
      )
    }
    db.beginMutationReceipt(mutation.identity)
    await gate
    return { attempt: { dispatchId: 'ctx_0123456789ab' } }
  })
}

describe('task-start mutation receipts', () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const db of databases.splice(0)) {
      db.close()
    }
    vi.restoreAllMocks()
  })

  it('lets the dispatch transaction insert the pending receipt itself', async () => {
    const { db, executor } = harness()
    databases.push(db)
    const invoke = startingDispatch(db)

    const result = await executor.run(taskStartRequest('task-start-1'), params, invoke)

    expect(invoke).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      attempt: { dispatchId: 'ctx_0123456789ab' },
      mutation: { requestId: 'task-start-1', replayed: false }
    })
    const fingerprint = executor.getLocalAuthenticatedCallerFingerprint()
    expect(db.getMutationReceipt(fingerprint, 'task-start-1')).toMatchObject({
      method: 'orchestration.taskStart',
      state: 'completed'
    })
  })

  it('replays a completed task-start without starting a second attempt', async () => {
    const { db, executor } = harness()
    databases.push(db)
    const invoke = startingDispatch(db)
    await executor.run(taskStartRequest('task-start-2'), params, invoke)

    const replay = await executor.run(taskStartRequest('task-start-2'), params, invoke)

    expect(invoke).toHaveBeenCalledOnce()
    expect(replay).toMatchObject({ mutation: { requestId: 'task-start-2', replayed: true } })
  })

  it('joins a concurrent identical task-start before its durable acceptance', async () => {
    const { db, executor } = harness()
    databases.push(db)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const invoke = startingDispatch(db, gate)

    const calls = Promise.all([
      executor.run(taskStartRequest('task-start-3'), params, invoke),
      executor.run(taskStartRequest('task-start-3'), params, invoke)
    ])
    release()
    const [first, joined] = await calls

    expect(invoke).toHaveBeenCalledOnce()
    expect(first).toMatchObject({ mutation: { replayed: false } })
    expect(joined).toMatchObject({ mutation: { replayed: true } })
  })

  it('fences the same request id reused for another task', async () => {
    const { db, executor } = harness()
    databases.push(db)
    await executor.run(taskStartRequest('task-start-4'), params, startingDispatch(db))
    const other = { taskId: 'task_ba9876543210' }

    await expect(
      executor.run(
        { ...taskStartRequest('task-start-4'), params: other },
        other,
        startingDispatch(db)
      )
    ).rejects.toMatchObject({ code: 'request_mismatch' })
  })
})
