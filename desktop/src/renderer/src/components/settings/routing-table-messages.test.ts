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
import { routingTableCallErrorMessage, routingTableRefusalMessage } from './routing-table-messages'
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

  it('names the damaged part of the store and says no default table replaces it', () => {
    const messages = INTEGRITY_DETAILS.map((detail) =>
      routingTableRefusalMessage(refusal('routing_table_integrity_failed', detail))
    )

    expect(new Set(messages).size).toBe(INTEGRITY_DETAILS.length)
    for (const message of messages) {
      expect(message).not.toMatch(SNAKE_CASE_CODE)
      expect(message).toMatch(/no default table is used/i)
    }
  })

  it('points at the waiting duplicate, or says the active table already has the content', () => {
    expect(
      routingTableRefusalMessage(refusal('duplicate_content', null, 'proposal-0042'))
    ).toContain('proposal-0042')
    expect(routingTableRefusalMessage(refusal('duplicate_content'))).toMatch(/active table/i)
  })

  it('keeps an unknown reason visible as its code rather than hiding it', () => {
    expect(routingTableRefusalMessage(refusal('brand_new_reason'))).toContain('brand_new_reason')
  })
})

describe('routingTableCallErrorMessage', () => {
  it('says the Routing Table is not connected when the method is not registered', () => {
    expect(routingTableCallErrorMessage(rpcError('method_not_found'))).toMatch(/not connected/i)
  })

  it('explains an uninstalled table and an untrusted caller', () => {
    expect(routingTableCallErrorMessage(rpcError('workbench_routing_table_unavailable'))).toMatch(
      /not available/i
    )
    expect(routingTableCallErrorMessage(rpcError('workbench_forbidden'))).toMatch(/desktop/i)
  })

  it('never repeats the raw error text, which could quote what was sent', () => {
    const message = routingTableCallErrorMessage(rpcError('runtime_error', 'secret-ish detail'))
    expect(message).not.toContain('secret-ish detail')
    expect(routingTableCallErrorMessage(new Error('boom detail'))).not.toContain('boom detail')
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
