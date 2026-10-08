import { describe, expect, it } from 'vitest'
import {
  DotDecisionAnswerResultSchema,
  DotDecisionsListResultSchema,
  DotDecisionViewSchema,
  type DotDecisionView
} from './dot-ingress-decision'

// FIXTURE_ONLY: synthetic ids; the summary is a tool name plus a command name, never contents.
const pending = {
  decisionId: '5b8f6f2a-48b6-4d10-9f4b-0c5d1a0a3a11',
  dotRequestId: 'd059ca24-0f93-4c06-b317-dc2a95d6920b',
  dotMayAllow: true,
  toolName: 'Bash',
  agentId: null,
  summary: 'Bash: git status',
  status: 'pending',
  decidedBy: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  deadlineAt: '2026-10-05T00:04:00.000Z',
  decidedAt: null
} satisfies DotDecisionView

describe('DotDecisionViewSchema', () => {
  it('accepts a pending decision and a decided one', () => {
    expect(DotDecisionViewSchema.parse(pending)).toEqual(pending)
    const decided = {
      ...pending,
      agentId: 'agent_7',
      status: 'allowed',
      decidedBy: 'dot',
      decidedAt: '2026-10-05T00:01:00.000Z'
    }
    expect(DotDecisionViewSchema.parse(decided)).toEqual(decided)
  })

  it('refuses any field that could carry request text, file contents or run internals', () => {
    for (const field of [
      'objective',
      'toolInput',
      'input',
      'command',
      'contents',
      'fileContents',
      'diff',
      'runId',
      'ownerId',
      'requestSha256',
      'workspaceId',
      'path',
      'updatedPermissions'
    ]) {
      expect(DotDecisionViewSchema.safeParse({ ...pending, [field]: 'x' }).success).toBe(false)
    }
  })

  it('holds the summary to one line of at most 500 characters', () => {
    expect(DotDecisionViewSchema.safeParse({ ...pending, summary: 'a'.repeat(500) }).success).toBe(
      true
    )
    expect(DotDecisionViewSchema.safeParse({ ...pending, summary: 'a'.repeat(501) }).success).toBe(
      false
    )
    for (const summary of ['', 'two\nlines', 'cr\rhere', 'tab\there', 'nul\0here', 'sep x']) {
      expect(DotDecisionViewSchema.safeParse({ ...pending, summary }).success).toBe(false)
    }
  })

  it('counts characters, not UTF-16 units, so a 500-emoji summary still fits', () => {
    expect(
      DotDecisionViewSchema.safeParse({ ...pending, summary: '\u{1F600}'.repeat(500) }).success
    ).toBe(true)
    expect(
      DotDecisionViewSchema.safeParse({ ...pending, summary: '\u{1F600}'.repeat(501) }).success
    ).toBe(false)
  })

  it('keeps a decision tied to a request of the dot, never anonymous', () => {
    expect(DotDecisionViewSchema.safeParse({ ...pending, dotRequestId: null }).success).toBe(false)
    expect(DotDecisionViewSchema.safeParse({ ...pending, dotRequestId: 'request-1' }).success).toBe(
      false
    )
  })

  it.each([
    ['pending', null, null, true],
    ['allowed', 'dot', '2026-10-05T00:01:00.000Z', true],
    ['denied', 'desktop', '2026-10-05T00:01:00.000Z', true],
    ['answered_in_terminal', 'terminal', '2026-10-05T00:01:00.000Z', true],
    ['expired', null, '2026-10-05T00:04:00.000Z', true],
    ['pending', 'dot', null, false],
    ['pending', null, '2026-10-05T00:01:00.000Z', false],
    ['allowed', null, '2026-10-05T00:01:00.000Z', false],
    ['allowed', 'terminal', '2026-10-05T00:01:00.000Z', false],
    ['allowed', 'dot', null, false],
    ['answered_in_terminal', 'dot', '2026-10-05T00:01:00.000Z', false],
    ['expired', 'dot', '2026-10-05T00:04:00.000Z', false]
  ])(
    'status %s with decidedBy %s and decidedAt %s is valid: %s',
    (status, decidedBy, decidedAt, ok) => {
      expect(
        DotDecisionViewSchema.safeParse({ ...pending, status, decidedBy, decidedAt }).success
      ).toBe(ok)
    }
  )

  it('refuses an unknown status, decider or tool name shape', () => {
    expect(DotDecisionViewSchema.safeParse({ ...pending, status: 'approved' }).success).toBe(false)
    expect(DotDecisionViewSchema.safeParse({ ...pending, toolName: 'Bash rm -rf' }).success).toBe(
      false
    )
    expect(DotDecisionViewSchema.safeParse({ ...pending, toolName: '' }).success).toBe(false)
    expect(DotDecisionViewSchema.safeParse({ ...pending, agentId: 'agent 7' }).success).toBe(false)
  })
})

describe('dot decision results', () => {
  it('lists at most 100 decisions', () => {
    expect(
      DotDecisionsListResultSchema.safeParse({ contractVersion: 3, decisions: [pending] }).success
    ).toBe(true)
    expect(
      DotDecisionsListResultSchema.safeParse({
        contractVersion: 3,
        decisions: Array.from({ length: 101 }, () => pending)
      }).success
    ).toBe(false)
  })

  it('reports whether this answer decided the prompt or a prior answer already had', () => {
    const decided = {
      ...pending,
      status: 'denied',
      decidedBy: 'desktop',
      decidedAt: '2026-10-05T00:01:00.000Z'
    }
    for (const outcome of ['decided', 'already_decided']) {
      expect(
        DotDecisionAnswerResultSchema.safeParse({ contractVersion: 3, outcome, decision: decided })
          .success
      ).toBe(true)
    }
    expect(
      DotDecisionAnswerResultSchema.safeParse({
        contractVersion: 3,
        outcome: 'not_found',
        decision: decided
      }).success
    ).toBe(false)
  })
})
