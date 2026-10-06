import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_LIST_DEFAULT_LIMIT,
  WORKBENCH_OBJECTIVE_MAX_LENGTH,
  WORKBENCH_REQUEST_ID_MAX_LENGTH,
  WORKBENCH_WORKSPACE_ID_MAX_LENGTH
} from '../workbench-request'
import {
  WorkbenchCancelParams,
  WorkbenchClefProfilePinParams,
  WorkbenchClefVerifyParams,
  WorkbenchListParams,
  WorkbenchSubmitParams
} from './workbench-params'
import * as workbenchParams from './workbench-params'

const submit = {
  workspaceId: 'repo::/workspace/app',
  objective: '  Inspect the parser.\r\nKeep the existing architecture.\n',
  idempotencyKey: '1bb86c1d-21ba-4e3a-9472-0758e6e9c4cb'
}
const cancel = { workspaceId: submit.workspaceId, requestId: 'request-1', expectedRevision: 1 }

describe('WorkbenchSubmitParams', () => {
  it('preserves the objective verbatim after checking it is nonblank', () => {
    expect(WorkbenchSubmitParams.parse(submit)).toEqual({ ...submit, requestedAccess: 'read_only' })
  })

  it('defaults requested access to read_only and accepts workspace_write additively', () => {
    expect(WorkbenchSubmitParams.parse(submit).requestedAccess).toBe('read_only')
    expect(
      WorkbenchSubmitParams.parse({ ...submit, requestedAccess: 'workspace_write' })
    ).toMatchObject({ requestedAccess: 'workspace_write' })
  })

  it.each(['full_access', 'READ_ONLY', '', null, true])(
    'rejects requested access %j outside the two levels',
    (requestedAccess) => {
      expect(WorkbenchSubmitParams.safeParse({ ...submit, requestedAccess }).success).toBe(false)
    }
  )

  it('takes an optional BCP 47 deliverable language without rewriting it', () => {
    expect(WorkbenchSubmitParams.parse(submit)).not.toHaveProperty('deliverableLanguage')
    expect(
      WorkbenchSubmitParams.parse({ ...submit, deliverableLanguage: 'zh-hant-tw' })
    ).toMatchObject({ deliverableLanguage: 'zh-hant-tw' })
  })

  it.each(['', 'english', 'x', 'en_US', 'e'.repeat(36), null])(
    'rejects deliverable language %j',
    (deliverableLanguage) => {
      expect(WorkbenchSubmitParams.safeParse({ ...submit, deliverableLanguage }).success).toBe(
        false
      )
    }
  )

  it.each(['', ' ', '\t\r\n'])('rejects blank workspace identity and objective %j', (value) => {
    expect(WorkbenchSubmitParams.safeParse({ ...submit, workspaceId: value }).success).toBe(false)
    expect(WorkbenchSubmitParams.safeParse({ ...submit, objective: value }).success).toBe(false)
  })

  it('accepts exact length bounds and rejects larger inputs', () => {
    expect(
      WorkbenchSubmitParams.safeParse({
        ...submit,
        workspaceId: 'w'.repeat(WORKBENCH_WORKSPACE_ID_MAX_LENGTH),
        objective: 'x'.repeat(WORKBENCH_OBJECTIVE_MAX_LENGTH)
      }).success
    ).toBe(true)
    expect(
      WorkbenchSubmitParams.safeParse({
        ...submit,
        workspaceId: 'w'.repeat(WORKBENCH_WORKSPACE_ID_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
    expect(
      WorkbenchSubmitParams.safeParse({
        ...submit,
        objective: 'x'.repeat(WORKBENCH_OBJECTIVE_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
  })

  it.each(['', 'request-1', 'not-a-uuid', '1bb86c1d-21ba-4e3a-9472-0758e6e9c4cb-extra'])(
    'rejects a malformed idempotency key %j',
    (idempotencyKey) => {
      expect(WorkbenchSubmitParams.safeParse({ ...submit, idempotencyKey }).success).toBe(false)
    }
  )
})

describe('WorkbenchListParams', () => {
  it('defaults the bounded page size and accepts an optional safe cursor', () => {
    expect(WorkbenchListParams.parse({ workspaceId: submit.workspaceId })).toEqual({
      workspaceId: submit.workspaceId,
      limit: WORKBENCH_LIST_DEFAULT_LIMIT
    })
    expect(
      WorkbenchListParams.parse({ workspaceId: submit.workspaceId, limit: 100, beforeSequence: 9 })
    ).toEqual({ workspaceId: submit.workspaceId, limit: 100, beforeSequence: 9 })
  })

  it.each([0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid limit %s',
    (limit) => {
      expect(
        WorkbenchListParams.safeParse({ workspaceId: submit.workspaceId, limit }).success
      ).toBe(false)
    }
  )

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, null])(
    'rejects an invalid cursor %s',
    (beforeSequence) => {
      expect(
        WorkbenchListParams.safeParse({ workspaceId: submit.workspaceId, beforeSequence }).success
      ).toBe(false)
    }
  )

  it('requires a nonblank bounded workspace scope instead of an unscoped list', () => {
    expect(WorkbenchListParams.safeParse({}).success).toBe(false)
    expect(WorkbenchListParams.safeParse({ workspaceId: '  ' }).success).toBe(false)
    expect(
      WorkbenchListParams.safeParse({
        workspaceId: 'w'.repeat(WORKBENCH_WORKSPACE_ID_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
  })
})

describe('WorkbenchCancelParams', () => {
  it('requires scoped identity and an observed positive revision', () => {
    expect(WorkbenchCancelParams.parse(cancel)).toEqual(cancel)
    expect(
      WorkbenchCancelParams.safeParse({
        ...cancel,
        requestId: 'r'.repeat(WORKBENCH_REQUEST_ID_MAX_LENGTH),
        expectedRevision: Number.MAX_SAFE_INTEGER
      }).success
    ).toBe(true)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid expected revision %s',
    (expectedRevision) => {
      expect(WorkbenchCancelParams.safeParse({ ...cancel, expectedRevision }).success).toBe(false)
    }
  )

  it('rejects omitted, blank or oversized request identities', () => {
    expect(WorkbenchCancelParams.safeParse({ workspaceId: submit.workspaceId }).success).toBe(false)
    expect(WorkbenchCancelParams.safeParse({ ...cancel, requestId: '\n\t' }).success).toBe(false)
    expect(WorkbenchCancelParams.safeParse({ ...cancel, workspaceId: '' }).success).toBe(false)
    expect(
      WorkbenchCancelParams.safeParse({
        ...cancel,
        requestId: 'r'.repeat(WORKBENCH_REQUEST_ID_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
  })
})

describe('Workbench params authority boundary', () => {
  it.each(['caller', 'approved', 'model', 'route', 'host', 'modelProfileId', 'executionSurface'])(
    'rejects caller-controlled %s in every method',
    (field) => {
      expect(WorkbenchSubmitParams.safeParse({ ...submit, [field]: 'injected' }).success).toBe(
        false
      )
      expect(
        WorkbenchListParams.safeParse({ workspaceId: submit.workspaceId, [field]: 'injected' })
          .success
      ).toBe(false)
      expect(WorkbenchCancelParams.safeParse({ ...cancel, [field]: 'injected' }).success).toBe(
        false
      )
    }
  )
})

describe('retired intake routing params', () => {
  it('exports no retry or decision-read schema, because D-016 has no routing at intake', () => {
    expect(Object.keys(workbenchParams).sort()).toEqual([
      'WorkbenchCancelParams',
      'WorkbenchClefProfilePinParams',
      'WorkbenchClefVerifyParams',
      'WorkbenchListParams',
      'WorkbenchSubmitParams'
    ])
  })
})

describe('WorkbenchClefVerifyParams', () => {
  it('accepts the empty object and nothing else', () => {
    expect(WorkbenchClefVerifyParams.parse({})).toEqual({})
    expect(WorkbenchClefVerifyParams.safeParse({ purpose: 'production' }).success).toBe(false)
    expect(WorkbenchClefVerifyParams.safeParse({ objective: 'Inspect.' }).success).toBe(false)
    expect(WorkbenchClefVerifyParams.safeParse({ maxMicroUsd: 1 }).success).toBe(false)
  })
})

describe('WorkbenchClefProfilePinParams', () => {
  const reportSha256 = 'ab'.repeat(32)

  it('requires exactly one lowercase SHA-256 report hash', () => {
    expect(WorkbenchClefProfilePinParams.parse({ reportSha256 })).toEqual({ reportSha256 })
  })

  it.each([
    '',
    'ab'.repeat(31),
    'ab'.repeat(33),
    'AB'.repeat(32),
    `${'ab'.repeat(31)}zz`,
    ` ${reportSha256}`
  ])('rejects a malformed report hash %j', (value) => {
    expect(WorkbenchClefProfilePinParams.safeParse({ reportSha256: value }).success).toBe(false)
  })

  it('rejects a missing hash and any field that would carry the profile itself', () => {
    expect(WorkbenchClefProfilePinParams.safeParse({}).success).toBe(false)
    expect(
      WorkbenchClefProfilePinParams.safeParse({ reportSha256, profile: { envelopeMode: 'bare' } })
        .success
    ).toBe(false)
    expect(
      WorkbenchClefProfilePinParams.safeParse({ reportSha256, expectedResponseModel: 'clef' })
        .success
    ).toBe(false)
  })
})

describe('Clef administration methods authority boundary', () => {
  it.each([
    'caller',
    'principalId',
    'approved',
    'model',
    'route',
    'modelProfileId',
    'executionSurface'
  ])('rejects caller-controlled %s', (field) => {
    expect(WorkbenchClefVerifyParams.safeParse({ [field]: 'injected' }).success).toBe(false)
    expect(
      WorkbenchClefProfilePinParams.safeParse({
        reportSha256: 'ab'.repeat(32),
        [field]: 'injected'
      }).success
    ).toBe(false)
  })
})
