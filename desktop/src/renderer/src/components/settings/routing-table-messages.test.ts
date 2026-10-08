import { describe, expect, it } from 'vitest'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  EXECUTION_TARGETS,
  REASONING_LEVELS,
  ROUTING_TASK_TYPES,
  VALIDATION_REVIEWER_TARGETS
} from '../../../../shared/routing-table/routing-table-taxonomy'
import {
  PROPOSAL_DECISIONS,
  ROUTING_TABLE_PROPOSERS
} from '../../../../shared/routing-table/routing-table-proposal-schema'
import {
  routingTableCallErrorDetails,
  routingTableCallErrorMessage,
  routingTableRefusalDetails,
  routingTableRefusalMessage
} from './routing-table-messages'
import {
  executionTargetLabel,
  proposalDecisionLabel,
  proposerLabel,
  reasoningLevelLabel,
  reviewerTargetLabel,
  taskTypeLabel
} from './routing-table-labels'

const SNAKE_CASE_CODE = /\b[a-z]+_[a-z_]+\b/

function refusal(reason: string, detail: string | null = null, existing: string | null = null) {
  return { ok: false as const, reason, detail, existingProposalId: existing }
}

function rpcError(code: string, message = 'raw main-side text'): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 'rpc-1', ok: false, error: { code, message } })
}

// Every reason the table store, its proposals and its activation can refuse with (A1, D3).
const STORE_REASONS = [
  'routing_table_integrity_failed',
  'routing_table_taxonomy_mismatch',
  'routing_table_not_installed',
  'invalid_table',
  'version_conflict',
  'forbidden_caller',
  'proposal_unknown',
  'proposal_invalid',
  'already_decided',
  'proposal_superseded',
  'no_change',
  'forbidden_proposer',
  'invalid_proposal',
  'base_not_active',
  'too_many_pending',
  'duplicate_content',
  'version_unknown'
]

const INTEGRITY_DETAILS = [
  'index_missing',
  'index_unreadable',
  'index_invalid',
  'version_missing',
  'version_unreadable',
  'version_invalid',
  'version_hash_mismatch'
]

describe('routingTableRefusalMessage', () => {
  it('explains every refusal reason in plain English instead of showing its code', () => {
    const messages = STORE_REASONS.map((reason) => routingTableRefusalMessage(refusal(reason)))

    for (const message of messages) {
      expect(message).not.toMatch(SNAKE_CASE_CODE)
      expect(message.length).toBeGreaterThan(20)
    }
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('says a damaged store routes nothing, in one plain message, and keeps the part in details', () => {
    const messages = INTEGRITY_DETAILS.map((detail) =>
      routingTableRefusalMessage(refusal('routing_table_integrity_failed', detail))
    )

    expect(new Set(messages).size).toBe(1)
    expect(messages[0]).toMatch(/no default is used/i)
    expect(messages[0]).not.toMatch(/index|hash|file/i)
    for (const detail of INTEGRITY_DETAILS) {
      expect(
        routingTableRefusalDetails(refusal('routing_table_integrity_failed', detail))
      ).toContain(`detail: ${detail}`)
    }
  })

  it('points at a waiting duplicate without its id, which stays in the details', () => {
    const waiting = refusal('duplicate_content', null, 'proposal-0042')
    expect(routingTableRefusalMessage(waiting)).not.toContain('proposal-0042')
    expect(routingTableRefusalMessage(waiting)).toMatch(/Suggested changes/)
    expect(routingTableRefusalDetails(waiting)).toContain('proposal-0042')
    expect(routingTableRefusalMessage(refusal('duplicate_content'))).toMatch(/already in use/i)
  })

  it('keeps an unknown reason out of the text and in the details', () => {
    expect(routingTableRefusalMessage(refusal('brand_new_reason'))).not.toContain(
      'brand_new_reason'
    )
    expect(routingTableRefusalDetails(refusal('brand_new_reason'))).toContain('brand_new_reason')
  })
})

describe('routingTableCallErrorMessage', () => {
  it('says task routing is not available when the method is not registered', () => {
    expect(routingTableCallErrorMessage(rpcError('method_not_found'))).toMatch(
      /not available in this build/i
    )
  })

  it('explains an uninstalled table and an untrusted caller', () => {
    expect(routingTableCallErrorMessage(rpcError('workbench_routing_table_unavailable'))).toMatch(
      /not available/i
    )
    expect(routingTableCallErrorMessage(rpcError('workbench_forbidden'))).toMatch(/desktop/i)
  })

  it('never repeats the raw error text, which could quote what was sent', () => {
    const error = rpcError('runtime_error', 'secret-ish detail')
    expect(routingTableCallErrorMessage(error)).not.toContain('secret-ish detail')
    expect(routingTableCallErrorDetails(error)).toBe('error: runtime_error')
    expect(routingTableCallErrorMessage(new Error('boom detail'))).not.toContain('boom detail')
    expect(routingTableCallErrorDetails(new Error('boom detail'))).not.toContain('boom detail')
  })
})

describe('routing table labels', () => {
  it('gives every taxonomy value a readable English label', () => {
    const labels = [
      ...ROUTING_TASK_TYPES.map(taskTypeLabel),
      ...EXECUTION_TARGETS.map(executionTargetLabel),
      ...REASONING_LEVELS.map(reasoningLevelLabel),
      ...VALIDATION_REVIEWER_TARGETS.map(reviewerTargetLabel),
      ...ROUTING_TABLE_PROPOSERS.map(proposerLabel),
      ...PROPOSAL_DECISIONS.map(proposalDecisionLabel)
    ]

    for (const label of labels) {
      expect(label).not.toMatch(SNAKE_CASE_CODE)
      expect(label.trim().length).toBeGreaterThan(1)
    }
    expect(new Set(ROUTING_TASK_TYPES.map(taskTypeLabel)).size).toBe(ROUTING_TASK_TYPES.length)
    expect(reasoningLevelLabel('xhigh')).toBe('Extra high')
    expect(new Set(REASONING_LEVELS.map(reasoningLevelLabel)).size).toBe(REASONING_LEVELS.length)
    expect(reasoningLevelLabel('none')).toBe('None')
    expect(reasoningLevelLabel('minimal')).toBe('Minimal')
    expect(reasoningLevelLabel('ultra')).toBe('Ultra')
    expect(executionTargetLabel('agy_cli')).toBe('agy CLI')
  })
})
