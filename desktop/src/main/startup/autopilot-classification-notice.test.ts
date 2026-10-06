import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { TaskClassificationRecord } from '../runtime/orchestration/db/task-classification-store'
import type { ClassificationSettled } from '../runtime/task-classification/classification-runtime'
import {
  createClassificationDbHarness,
  fixtureClassifyTime,
  proposeFixtureTask
} from '../runtime/task-classification/classification-db.test-fixture'
import {
  CLASSIFICATION_NOTICE_SENDER,
  createClassificationNotice
} from './autopilot-classification-notice'

const owners: OrchestrationDb[] = []

afterEach(() => {
  for (const owner of owners.splice(0)) {
    owner.close()
  }
})

function classification(
  taskId: string,
  overrides: Partial<TaskClassificationRecord> = {}
): TaskClassificationRecord {
  return {
    classificationId: 'classification-fixture-1',
    taskId,
    attempt: 1,
    outcome: 'classified',
    detail: null,
    needsDelegation: true,
    taskType: 'software_engineering',
    answers: null,
    bundleSha256: null,
    taxonomyVersion: 1,
    profileSha256: null,
    classifierModel: null,
    rawResponseId: null,
    spendReservationId: null,
    createdAt: fixtureClassifyTime(3),
    orphaned: false,
    ...overrides
  }
}

function setup() {
  const harness = createClassificationDbHarness()
  owners.push(harness.owner)
  const task = proposeFixtureTask(harness)
  const announce = vi.fn()
  const log = vi.fn()
  const notice = createClassificationNotice({
    owner: harness.owner,
    cliCommand: 'orca',
    announce,
    log
  })
  const messages = () =>
    harness.owner.db
      .prepare(
        'SELECT from_handle, to_handle, subject, body, type, payload FROM messages WHERE run_id = ?'
      )
      .all(harness.runId)
  return { harness, task, announce, log, notice, messages }
}

describe('createClassificationNotice', () => {
  it('posts one status notice to the run mailbox and announces it', () => {
    const { harness, task, announce, notice, messages } = setup()
    const settled: ClassificationSettled = {
      status: 'recorded',
      taskId: task.taskId,
      classification: classification(task.taskId),
      route: { kind: 'refused', reason: 'routing_table_not_installed' },
      cacheHit: false
    }
    notice(settled)
    const rows = messages()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      from_handle: CLASSIFICATION_NOTICE_SENDER,
      to_handle: `run:${harness.runId}`,
      type: 'status'
    })
    expect(JSON.parse(String(rows[0]?.payload))).toEqual({
      kind: 'task_classified',
      taskId: task.taskId,
      outcome: 'classified'
    })
    expect(String(rows[0]?.body)).toContain(`--task ${task.taskId} --json`)
    expect(String(rows[0]?.body)).toContain('routing_table_not_installed')
    expect(announce).toHaveBeenCalledTimes(1)
  })

  it('names codes only, never the TaskSpec text', () => {
    const { task, notice, messages } = setup()
    notice({ status: 'failed', taskId: task.taskId, code: 'autopilot_classification_failed' })
    const body = String(messages()[0]?.body)
    expect(body).toContain('autopilot_classification_failed')
    expect(body).not.toContain(task.objective)
  })

  it('posts nothing for a task Orca no longer holds', () => {
    const { notice, messages, announce } = setup()
    notice({
      status: 'failed',
      taskId: 'task_unknown_fixture',
      code: 'autopilot_classification_failed'
    })
    expect(messages()).toHaveLength(0)
    expect(announce).not.toHaveBeenCalled()
  })

  it('posts nothing for a TaskSpec whose Orca task is gone, as after an Orca reset', () => {
    const { harness, task, notice, messages, announce, log } = setup()
    harness.owner.db.prepare('DELETE FROM tasks WHERE id = ?').run(task.taskId)
    notice({ status: 'failed', taskId: task.taskId, code: 'autopilot_classification_failed' })
    expect(messages()).toHaveLength(0)
    expect(announce).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('logs a failing announce by code and keeps the notice', () => {
    const { task, notice, messages, announce, log } = setup()
    announce.mockImplementation(() => {
      throw new Error('C:/private/path should not be logged')
    })
    notice({ status: 'failed', taskId: task.taskId, code: 'autopilot_classification_failed' })
    expect(messages()).toHaveLength(1)
    expect(log).toHaveBeenCalledWith({
      event: 'classification_notice_failed',
      taskId: task.taskId,
      code: 'install_failed'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('private')
  })
})
