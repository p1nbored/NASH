import { describe, expect, it } from 'vitest'
import {
  DotCancelParams,
  DotClientDescriptorSchema,
  DotDecisionAnswerParams,
  DotDecisionsListParams,
  DotHelloParams,
  DotListParams,
  DotReplyMetadataSchema,
  DotStatusParams,
  DotSubmitParams,
  DotWorkspaceRefSchema,
  DotWorkspacesParams
} from './dot-ingress-params'

// FIXTURE_ONLY: synthetic ids; nothing here names a real workspace or request.
const WORKSPACE_REF = 'dws_0123456789abcdef01234567'
const KEY = '5b8f6f2a-48b6-4d10-9f4b-0c5d1a0a3a11'
const REQUEST_ID = 'd059ca24-0f93-4c06-b317-dc2a95d6920b'

const submit = {
  contractVersion: 1,
  workspaceRef: WORKSPACE_REF,
  objective: 'Summarize the open issues in `docs/plan.md`.',
  idempotencyKey: KEY
}

// The authority and routing fields the contract must never accept from a sender.
const FORBIDDEN_FIELDS = [
  'approved',
  'permissionState',
  'principalId',
  'workbenchCaller',
  'route',
  'executionSurface',
  'modelProfileId',
  'hostId',
  'projectId',
  'dataClass',
  'sensitivity',
  'source',
  'senderAuth',
  'workspaceId',
  'workspacePath',
  'confirm',
  'confirmed',
  'skipConfirmation',
  'targetModel',
  'effort'
]

describe('dot ingress params: contract version', () => {
  it.each([
    ['submit', DotSubmitParams, submit],
    ['status', DotStatusParams, { contractVersion: 1, dotRequestId: REQUEST_ID }],
    ['list', DotListParams, { contractVersion: 1 }],
    ['cancel', DotCancelParams, { contractVersion: 1, dotRequestId: REQUEST_ID }],
    ['hello', DotHelloParams, { contractVersion: 1 }],
    ['workspaces', DotWorkspacesParams, { contractVersion: 1 }],
    ['decisions list', DotDecisionsListParams, { contractVersion: 1 }],
    [
      'decision answer',
      DotDecisionAnswerParams,
      { contractVersion: 1, decisionId: REQUEST_ID, decision: 'allow' }
    ]
  ])('accepts version 1 and refuses any other version for %s', (_label, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true)
    for (const wrong of [2, 0, '1', null, undefined]) {
      expect(schema.safeParse({ ...valid, contractVersion: wrong }).success).toBe(false)
    }
    const { contractVersion: _omitted, ...withoutVersion } = valid
    expect(schema.safeParse(withoutVersion).success).toBe(false)
  })
})

describe('dot ingress params: strictness', () => {
  const cases = [
    ['submit', DotSubmitParams, submit],
    ['status', DotStatusParams, { contractVersion: 1, dotRequestId: REQUEST_ID }],
    ['list', DotListParams, { contractVersion: 1 }],
    ['cancel', DotCancelParams, { contractVersion: 1, dotRequestId: REQUEST_ID }],
    ['hello', DotHelloParams, { contractVersion: 1 }],
    ['workspaces', DotWorkspacesParams, { contractVersion: 1 }],
    ['decisions list', DotDecisionsListParams, { contractVersion: 1 }],
    [
      'decision answer',
      DotDecisionAnswerParams,
      { contractVersion: 1, decisionId: REQUEST_ID, decision: 'deny' }
    ]
  ] as const

  it.each(cases)('refuses an unknown field on %s', (_label, schema, valid) => {
    expect(schema.safeParse({ ...valid, extra: true }).success).toBe(false)
  })

  describe.each(cases)('%s refuses caller-controlled authority', (_label, schema, valid) => {
    it.each(FORBIDDEN_FIELDS)('%s', (field) => {
      expect(schema.safeParse({ ...valid, [field]: 'claimed-authority' }).success).toBe(false)
    })
  })

  it('refuses nested unknown fields on the client and reply descriptors', () => {
    expect(
      DotSubmitParams.safeParse({ ...submit, client: { name: 'dot', version: '1', extra: 1 } })
        .success
    ).toBe(false)
    expect(
      DotSubmitParams.safeParse({ ...submit, reply: { correlationId: 'a', route: 'x' } }).success
    ).toBe(false)
  })
})

describe('dot ingress submit params', () => {
  it('accepts the minimal request and keeps optional fields optional', () => {
    const parsed = DotSubmitParams.parse(submit)
    expect(parsed.requestedAccess).toBe('read_only')
    expect(parsed.deliverableLanguage).toBeUndefined()
    expect(parsed.reply).toBeUndefined()
    expect(parsed.client).toBeUndefined()
  })

  it('accepts every optional field together', () => {
    const full = {
      ...submit,
      requestedAccess: 'workspace_write',
      deliverableLanguage: 'zh-Hant-TW',
      reply: { correlationId: 'conv_1:msg/2=+x' },
      client: { name: 'dot-local', version: '0.1.0+build.5' }
    }
    expect(DotSubmitParams.parse(full)).toEqual(full)
  })

  it('defaults the requested access to read_only and records an explicit value as given', () => {
    expect(DotSubmitParams.parse(submit).requestedAccess).toBe('read_only')
    for (const requestedAccess of ['read_only', 'workspace_write'] as const) {
      expect(DotSubmitParams.parse({ ...submit, requestedAccess }).requestedAccess).toBe(
        requestedAccess
      )
    }
  })

  it.each(['admin', 'write', 'READ_ONLY', '', null, 1, true])(
    'refuses the requested access %j instead of mapping it to something else',
    (requestedAccess) => {
      expect(DotSubmitParams.safeParse({ ...submit, requestedAccess }).success).toBe(false)
    }
  )

  it.each(['en_US', 'x-foo', '', 'en US', 'a'.repeat(36)])(
    'refuses the deliverable language %j',
    (tag) => {
      expect(DotSubmitParams.safeParse({ ...submit, deliverableLanguage: tag }).success).toBe(false)
    }
  )

  it('does not rewrite a valid tag on the wire; the service stores the canonical form', () => {
    expect(DotSubmitParams.parse({ ...submit, deliverableLanguage: 'zh-hant-tw' })).toMatchObject({
      deliverableLanguage: 'zh-hant-tw'
    })
  })

  it.each([
    ['blank objective', { objective: '   ' }],
    ['empty objective', { objective: '' }],
    ['NUL in objective', { objective: 'a\0b' }],
    ['lone surrogate', { objective: 'a\ud800b' }],
    ['over 12,000 characters', { objective: 'a'.repeat(12_001) }],
    ['non-string objective', { objective: 42 }],
    ['non-uuid key', { idempotencyKey: 'not-a-uuid' }],
    ['workspace id instead of a ref', { workspaceRef: 'repo::/workspace/app' }],
    ['uppercase ref', { workspaceRef: 'dws_0123456789ABCDEF01234567' }],
    ['short ref', { workspaceRef: 'dws_0123' }]
  ])('refuses %s', (_label, override) => {
    expect(DotSubmitParams.safeParse({ ...submit, ...override }).success).toBe(false)
  })

  it('keeps the objective bytes untouched, including edge whitespace and line endings', () => {
    const objective = '  Écris le plan.\r\nKeep `docs/Résumé.md` as is.  '
    expect(DotSubmitParams.parse({ ...submit, objective }).objective).toBe(objective)
  })

  it('accepts exactly 12,000 characters', () => {
    expect(DotSubmitParams.safeParse({ ...submit, objective: 'a'.repeat(12_000) }).success).toBe(
      true
    )
  })
})

describe('dot ingress descriptors', () => {
  it.each(['dot', 'dot-local_1.2', 'A'.repeat(64)])('accepts the client name %s', (name) => {
    expect(DotClientDescriptorSchema.safeParse({ name, version: '1' }).success).toBe(true)
  })

  it.each(['', 'dot local', 'dot/local', 'A'.repeat(65), 'dot\n', 'doté'])(
    'refuses the client name %j',
    (name) => {
      expect(DotClientDescriptorSchema.safeParse({ name, version: '1' }).success).toBe(false)
    }
  )

  it.each(['', '1 0', '1'.repeat(33), '1/0'])('refuses the client version %j', (version) => {
    expect(DotClientDescriptorSchema.safeParse({ name: 'dot', version }).success).toBe(false)
  })

  it('limits the correlation id to 128 ASCII reference characters', () => {
    expect(DotReplyMetadataSchema.safeParse({ correlationId: 'a'.repeat(128) }).success).toBe(true)
    expect(DotReplyMetadataSchema.safeParse({ correlationId: 'a'.repeat(129) }).success).toBe(false)
    expect(DotReplyMetadataSchema.safeParse({ correlationId: '' }).success).toBe(false)
    expect(DotReplyMetadataSchema.safeParse({ correlationId: 'a b' }).success).toBe(false)
    expect(DotReplyMetadataSchema.safeParse({ correlationId: 'café' }).success).toBe(false)
    expect(DotReplyMetadataSchema.safeParse({}).success).toBe(true)
  })

  it('accepts only the opaque workspace ref shape, which carries no path material', () => {
    expect(DotWorkspaceRefSchema.safeParse(WORKSPACE_REF).success).toBe(true)
    for (const bad of ['dws_', 'ws_0123456789abcdef01234567', 'dws_0123456789abcdef0123456g']) {
      expect(DotWorkspaceRefSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('dot ingress list, status and cancel params', () => {
  it('defaults the page size to 50 and caps it at 100', () => {
    expect(DotListParams.parse({ contractVersion: 1 }).limit).toBe(50)
    expect(DotListParams.safeParse({ contractVersion: 1, limit: 100 }).success).toBe(true)
    for (const limit of [0, 101, -1, 1.5, '5']) {
      expect(DotListParams.safeParse({ contractVersion: 1, limit }).success).toBe(false)
    }
  })

  it('accepts a positive paging cursor only', () => {
    expect(DotListParams.safeParse({ contractVersion: 1, beforeSequence: 7 }).success).toBe(true)
    expect(DotListParams.safeParse({ contractVersion: 1, beforeSequence: 0 }).success).toBe(false)
  })

  it('addresses a request by its own uuid only', () => {
    for (const schema of [DotStatusParams, DotCancelParams]) {
      expect(schema.safeParse({ contractVersion: 1, dotRequestId: 'request-1' }).success).toBe(
        false
      )
      expect(schema.safeParse({ contractVersion: 1 }).success).toBe(false)
    }
  })
})

describe('dot ingress decision params', () => {
  it('lists with an optional request filter and the same paging limits', () => {
    expect(DotDecisionsListParams.parse({ contractVersion: 1 }).limit).toBe(50)
    expect(
      DotDecisionsListParams.safeParse({ contractVersion: 1, dotRequestId: REQUEST_ID, limit: 100 })
        .success
    ).toBe(true)
    expect(DotDecisionsListParams.safeParse({ contractVersion: 1, limit: 101 }).success).toBe(false)
    expect(
      DotDecisionsListParams.safeParse({ contractVersion: 1, dotRequestId: 'x' }).success
    ).toBe(false)
  })

  it('answers with allow or deny and nothing else', () => {
    const base = { contractVersion: 1, decisionId: REQUEST_ID }
    expect(DotDecisionAnswerParams.safeParse({ ...base, decision: 'allow' }).success).toBe(true)
    expect(DotDecisionAnswerParams.safeParse({ ...base, decision: 'deny' }).success).toBe(true)
    for (const decision of ['allowed', 'ALLOW', 'approve', '', null, true]) {
      expect(DotDecisionAnswerParams.safeParse({ ...base, decision }).success).toBe(false)
    }
    expect(DotDecisionAnswerParams.safeParse({ ...base }).success).toBe(false)
  })

  it('carries no updated permissions, rules or free-text reason a model could use to widen access', () => {
    const base = { contractVersion: 1, decisionId: REQUEST_ID, decision: 'allow' }
    for (const field of [
      'updatedPermissions',
      'reason',
      'rules',
      'scope',
      'remember',
      'toolInput'
    ]) {
      expect(DotDecisionAnswerParams.safeParse({ ...base, [field]: 'x' }).success).toBe(false)
    }
  })
})
