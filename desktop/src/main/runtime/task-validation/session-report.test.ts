import { describe, expect, it } from 'vitest'
import type { MessageRow, MessageType } from '../orchestration/types'
import { readSessionReport, type SessionReportMailbox } from './session-report'

// FIXTURE_ONLY: the token below is synthetic and matches no real credential.
const FAKE_TOKEN = `sk-${'x'.repeat(24)}`
const ATTEMPT = { taskId: 'task_1', runId: 'run_1', dispatchId: 'ctx_1' }

function notice(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'msg_1',
    run_id: 'run_1',
    from_handle: 'dispatch:ctx_1',
    to_handle: 'run:run_1',
    subject: 'Task claimed',
    body: 'I wrote report.md and ran the tests.',
    type: 'status',
    priority: 'normal',
    thread_id: null,
    payload: JSON.stringify({ taskId: 'task_1', dispatchId: 'ctx_1', outcome: 'claimed' }),
    read: 0,
    sequence: 1,
    created_at: '2026-10-05T00:00:00.000Z',
    delivered_at: null,
    sender_pane_key: null,
    ...overrides
  }
}

function mailboxHolding(rows: MessageRow[]): SessionReportMailbox & {
  asked: [string, number | undefined, MessageType[] | undefined][]
} {
  const asked: [string, number | undefined, MessageType[] | undefined][] = []
  return {
    asked,
    getAllMessagesForHandle: (toHandle, limit, types) => {
      asked.push([toHandle, limit, types])
      return rows
    }
  }
}

describe('in-session report from the run mailbox', () => {
  it("reads the claim notice body of the current attempt from the run's status messages", () => {
    const mailbox = mailboxHolding([
      notice({ id: 'msg_other', from_handle: 'dispatch:ctx_2' }),
      notice()
    ])
    expect(readSessionReport(mailbox, ATTEMPT)).toEqual({
      status: 'ok',
      text: 'I wrote report.md and ran the tests.',
      messageId: 'msg_1'
    })
    expect(mailbox.asked).toEqual([['run:run_1', 500, ['status']]])
  })

  it('is missing when this attempt filed no claim notice, or one with no body', () => {
    const failedNotice = notice({
      payload: JSON.stringify({ taskId: 'task_1', dispatchId: 'ctx_1', outcome: 'failed' })
    })
    const notJson = notice({ payload: 'claimed' })
    for (const rows of [[], [failedNotice], [notJson], [notice({ body: '' })]]) {
      expect(readSessionReport(mailboxHolding(rows), ATTEMPT)).toEqual({ status: 'missing' })
    }
  })

  it('does not match when the notice names another task, dispatch or run, or there are two', () => {
    const otherTask = JSON.stringify({ taskId: 'task_2', dispatchId: 'ctx_1', outcome: 'claimed' })
    const otherDispatch = JSON.stringify({
      taskId: 'task_1',
      dispatchId: 'ctx_9',
      outcome: 'claimed'
    })
    for (const rows of [
      [notice({ payload: otherTask })],
      [notice({ payload: otherDispatch })],
      [notice({ run_id: 'run_2' })],
      [notice({ id: 'msg_2', sequence: 2 }), notice()]
    ]) {
      expect(readSessionReport(mailboxHolding(rows), ATTEMPT)).toEqual({ status: 'mismatched' })
    }
  })

  it('bounds the body and masks a secret shape again, whatever the writer checked', () => {
    const read = readSessionReport(
      mailboxHolding([notice({ body: `Used ${FAKE_TOKEN} then ${'a'.repeat(3000)}` })]),
      ATTEMPT
    )
    expect(read.status).toBe('ok')
    const text = read.status === 'ok' ? read.text : ''
    expect(text).not.toContain(FAKE_TOKEN)
    expect(text.length).toBeLessThanOrEqual(2000)
  })
})
