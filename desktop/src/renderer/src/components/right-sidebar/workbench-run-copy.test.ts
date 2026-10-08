import { describe, expect, it, vi } from 'vitest'
import {
  liveActivityLabel,
  primarySessionLabel,
  runEndReasonLabel,
  runSessionNote,
  runStateChip,
  runStatusChip
} from './workbench-run-copy'
import { describeRunMessageResult } from './workbench-run-message-copy'
import { describeAnswerResult, permissionStatusChip } from './workbench-permission-copy'
import { requestStatusChip } from './WorkbenchRequestStateChip'
import { permissionView, primarySession, runView } from './workbench-run-test-fixture'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(values?.[key] ?? ''))
}))

// The reason codes C3's deliverRunMessage returns (wp-c3-result.md, UI-1 section).
const QUEUED_REASONS = ['agent_busy', 'dialog_open', 'behind_held_message']
const REFUSED_REASONS = [
  'invalid_request',
  'request_id_reused',
  'text_empty',
  'text_too_long',
  'control_characters',
  'secret_shaped',
  'too_many_quoted_spans',
  'not_english',
  'run_not_found',
  'run_not_active',
  'run_not_owned_by_source',
  'primary_not_live',
  'hold_capacity_exceeded',
  'hold_expired',
  'terminal_unavailable',
  'delivery_incomplete',
  'delivery_unconfirmed'
]

function sent(outcome: 'delivered' | 'queued' | 'refused', reason: string | null) {
  return { outcome, reason, messageId: null, state: null, duplicate: false }
}

describe('run labels', () => {
  it('names every run status in words with a kind of its own', () => {
    expect(runStatusChip('active')).toEqual({ label: 'Active', kind: 'running' })
    expect(runStatusChip('launching')).toEqual({ label: 'Launching', kind: 'progress' })
    expect(runStatusChip('completed')).toEqual({ label: 'Completed', kind: 'done' })
    expect(runStatusChip('canceled')).toEqual({ label: 'Canceled', kind: 'ended' })
    expect(runStatusChip('failed')).toEqual({ label: 'Failed', kind: 'failed' })
    expect(runStatusChip('unverifiable')).toEqual({
      label: 'Cannot be verified',
      kind: 'disconnected'
    })
  })

  it('shows what the session of an active run is doing, and never guesses an unread one', () => {
    const live = (activity: 'working' | 'dialog_open' | 'idle' | 'unknown') =>
      runView(1, { primary: primarySession({ live: { kind: 'live', activity } }) })
    expect(runStateChip(live('working'), false)).toEqual({ label: 'Working', kind: 'running' })
    expect(runStateChip(live('idle'), false)).toEqual({
      label: 'Waiting for input',
      kind: 'waiting'
    })
    expect(runStateChip(live('dialog_open'), false)).toEqual({
      label: 'Needs an answer',
      kind: 'permission'
    })
    expect(runStateChip(live('unknown'), false)).toEqual({
      label: 'Activity unknown',
      kind: 'unknown'
    })
    expect(runStateChip(live('working'), true)).toEqual({
      label: 'Cannot be verified',
      kind: 'disconnected'
    })
    const absent = runView(1, { primary: primarySession({ live: { kind: 'agent_absent' } }) })
    expect(runStateChip(absent, false).kind).toBe('disconnected')
    expect(runStateChip(runView(1), false)).toEqual({ label: 'Active', kind: 'running' })
    expect(runStateChip(runView(1, { status: 'failed' }), false).kind).toBe('failed')
  })

  it('adds a session note only when the chip needs explaining', () => {
    expect(runSessionNote(runView(1), false)).toBeNull()
    expect(runSessionNote(runView(1), true)).toBe('Activity could not be read')
    expect(
      runSessionNote(
        runView(1, {
          primary: primarySession({ live: { kind: 'live', activity: 'dialog_open' } })
        }),
        false
      )
    ).toBe('A permission or question dialog is open')
    expect(
      runSessionNote(runView(1, { primary: primarySession({ state: 'exited' }) }), false)
    ).toBe('Session: Exited')
    expect(runSessionNote(runView(1, { primary: null }), false)).toBe('Session: Not started')
    expect(
      runSessionNote(
        runView(1, { status: 'completed', primary: primarySession({ state: 'exited' }) }),
        false
      )
    ).toBeNull()
  })

  it('gives each request state its own kind', () => {
    expect(requestStatusChip('ROUTING_BLOCKED')).toEqual({
      label: 'Launch blocked',
      kind: 'blocked'
    })
    expect(requestStatusChip('ROUTING')).toEqual({ label: 'Starting', kind: 'progress' })
    expect(requestStatusChip('ROUTED')).toEqual({ label: 'Run started', kind: 'done' })
    expect(requestStatusChip('CANCELED')).toEqual({ label: 'Canceled', kind: 'ended' })
  })

  it('describes the primary session and what it is doing now', () => {
    expect(primarySessionLabel(null)).toBe('Not started')
    expect(primarySessionLabel(primarySession({ state: 'running' }))).toBe('Running')
    expect(primarySessionLabel(primarySession({ state: 'unverifiable' }))).toBe(
      'Cannot be verified'
    )
    expect(liveActivityLabel(null)).toBeNull()
    expect(liveActivityLabel({ kind: 'live', activity: 'working' })).toBe('Claude is working')
    expect(liveActivityLabel({ kind: 'live', activity: 'dialog_open' })).toBe(
      'A permission or question dialog is open'
    )
    expect(liveActivityLabel({ kind: 'live', activity: 'idle' })).toBe('Waiting for input')
    expect(liveActivityLabel({ kind: 'agent_absent' })).toBe(
      'Claude Code is not running in the terminal'
    )
    expect(liveActivityLabel({ kind: 'unverifiable', reason: 'incarnation_mismatch' })).toBe(
      'The terminal process changed, so its activity cannot be verified'
    )
  })

  it('explains known end reasons and leaves an unknown code out of the UI', () => {
    expect(runEndReasonLabel('user_canceled')).toBe('Stopped in the app')
    expect(runEndReasonLabel('dot_canceled')).toBe('Canceled by dot')
    expect(runEndReasonLabel('some_new_reason')).toBeNull()
  })
})

describe('message outcome copy', () => {
  it('reports a delivery and a replayed delivery without echoing the text', () => {
    expect(describeRunMessageResult(sent('delivered', null))).toEqual({
      tone: 'neutral',
      text: 'Delivered to the session.',
      detail: null
    })
    expect(describeRunMessageResult({ ...sent('delivered', null), duplicate: true }).text).toBe(
      'Delivered to the session. This message was sent before, so it was not sent again.'
    )
  })

  it('gives every queued and refused reason a plain-English sentence, never the raw code', () => {
    for (const reason of QUEUED_REASONS) {
      const copy = describeRunMessageResult(sent('queued', reason))
      expect(copy.tone).toBe('neutral')
      expect(copy.text.startsWith('Queued.') || copy.text.startsWith('Held.')).toBe(true)
      expect(copy.text).not.toContain(reason)
    }
    for (const reason of REFUSED_REASONS) {
      const copy = describeRunMessageResult(sent('refused', reason))
      expect(copy.tone).toBe('warning')
      expect(copy.text.startsWith('Not sent.')).toBe(true)
      expect(copy.text).not.toContain(reason)
    }
    expect(describeRunMessageResult(sent('refused', 'not_english'))).toEqual({
      tone: 'warning',
      text: 'Not sent. Write the message in English; put names or text in another language in quotes.',
      // Why a separate detail: the refusal callout is already titled "Message not sent".
      detail: 'Write the message in English; put names or text in another language in quotes.'
    })
    expect(describeRunMessageResult(sent('queued', 'agent_busy')).text).toBe(
      'Queued. Claude is working, so the message waits in the session.'
    )
  })

  it('words an unknown reason generically and never shows the code', () => {
    expect(describeRunMessageResult(sent('refused', 'future_reason')).text).toBe(
      'Not sent. The session did not accept the message.'
    )
    expect(describeRunMessageResult(sent('refused', null)).text).toBe(
      'Not sent. No reason was given.'
    )
    expect(describeRunMessageResult(sent('queued', 'future_reason')).text).toBe(
      'Queued. It is sent when the session can take it.'
    )
  })
})

describe('permission prompt copy', () => {
  it('marks waiting prompts and prompts only the terminal can still answer', () => {
    expect(permissionStatusChip(permissionView())).toEqual({
      label: 'Waiting for an answer',
      kind: 'permission'
    })
    expect(permissionStatusChip(permissionView({ answerable: false }))).toEqual({
      label: 'Answer in the terminal',
      kind: 'permission'
    })
    expect(
      permissionStatusChip(permissionView({ status: 'answered_in_terminal', answerable: false }))
    ).toEqual({ label: 'Answered in the terminal', kind: 'ended' })
    expect(
      permissionStatusChip(permissionView({ status: 'allowed', answerable: false })).kind
    ).toBe('done')
  })

  it('reports each answer outcome in words', () => {
    const decided = permissionView({ status: 'allowed', decidedBy: 'desktop', answerable: false })
    expect(describeAnswerResult({ outcome: 'decided', decision: decided })).toBe(
      'Allowed in the app.'
    )
    expect(
      describeAnswerResult({
        outcome: 'already_decided',
        decision: permissionView({ status: 'denied', decidedBy: 'dot', answerable: false })
      })
    ).toBe('Already answered: denied by dot.')
    expect(
      describeAnswerResult({
        outcome: 'closed',
        decision: permissionView({ answerable: false })
      })
    ).toBe('Answer it in the terminal. The app can no longer answer this prompt.')
    expect(describeAnswerResult({ outcome: 'not_found', decision: null })).toBe(
      'This prompt is no longer available.'
    )
  })
})
