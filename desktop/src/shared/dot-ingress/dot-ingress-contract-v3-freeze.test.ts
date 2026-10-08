import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DOT_INGRESS_ERROR_CODES } from './dot-ingress-errors'
import {
  DotCancelParams,
  DotDecisionAnswerParams,
  DotDecisionsListParams,
  DotHelloParams,
  DotListParams,
  DotStatusParams,
  DotSubmitParams,
  DotWorkspacesParams
} from './dot-ingress-params'
import {
  DotCancelResultSchema,
  DotHelloResultSchema,
  DotListResultSchema,
  DotRequestViewSchema,
  DotStatusResultSchema,
  DotSubmitResultSchema,
  DotWorkspacesResultSchema
} from './dot-ingress-request'
import {
  DotDecisionAnswerResultSchema,
  DotDecisionsListResultSchema,
  DotDecisionViewSchema
} from './dot-ingress-decision'
import { DotMessageParams, DotMessageResultSchema } from './dot-ingress-message'
import {
  DotValidationDecideParamsV3,
  DotValidationDecideResultV3Schema,
  DotValidationsListParamsV3,
  DotValidationsListResultV3Schema,
  DotValidationViewSchema
} from './dot-ingress-validation'
import { DOT_INGRESS_METHOD_NAMES } from './dot-ingress-versions'

// The generated contract snapshot for the current ingress surface.
const CONTRACT_V3: Readonly<Record<string, z.ZodType>> = {
  'params.hello': DotHelloParams,
  'params.workspaces': DotWorkspacesParams,
  'params.submit': DotSubmitParams,
  'params.status': DotStatusParams,
  'params.list': DotListParams,
  'params.cancel': DotCancelParams,
  'params.message': DotMessageParams,
  'params.decisions.list': DotDecisionsListParams,
  'params.decisions.answer': DotDecisionAnswerParams,
  'params.validations.list': DotValidationsListParamsV3,
  'params.validations.decide': DotValidationDecideParamsV3,
  'result.hello': DotHelloResultSchema,
  'result.workspaces': DotWorkspacesResultSchema,
  'result.submit': DotSubmitResultSchema,
  'result.status': DotStatusResultSchema,
  'result.list': DotListResultSchema,
  'result.cancel': DotCancelResultSchema,
  'result.message': DotMessageResultSchema,
  'result.decisions.list': DotDecisionsListResultSchema,
  'result.decisions.answer': DotDecisionAnswerResultSchema,
  'result.validations.list': DotValidationsListResultV3Schema,
  'result.validations.decide': DotValidationDecideResultV3Schema,
  'view.request': DotRequestViewSchema,
  'view.decision': DotDecisionViewSchema,
  'view.validation': DotValidationViewSchema,
  // The current closed error catalog.
  'error.code': z.enum(DOT_INGRESS_ERROR_CODES)
}

const METHOD_KEYS: Readonly<Record<(typeof DOT_INGRESS_METHOD_NAMES)[number], string>> = {
  'dotIngress.hello': 'hello',
  'dotIngress.workspaces.list': 'workspaces',
  'dotIngress.requests.submit': 'submit',
  'dotIngress.requests.status': 'status',
  'dotIngress.requests.list': 'list',
  'dotIngress.requests.cancel': 'cancel',
  'dotIngress.requests.message': 'message',
  'dotIngress.decisions.list': 'decisions.list',
  'dotIngress.decisions.answer': 'decisions.answer',
  'dotIngress.validations.list': 'validations.list',
  'dotIngress.validations.decide': 'validations.decide'
}

describe('dot ingress contract v3 freeze', () => {
  it.each(Object.entries(CONTRACT_V3))('%s converts to JSON Schema', (_name, schema) => {
    expect(() => z.toJSONSchema(schema)).not.toThrow()
  })

  it('matches the golden JSON Schema snapshot', async () => {
    const snapshot = z.toJSONSchema(z.object(CONTRACT_V3), { reused: 'ref' })
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(
      './dot-ingress-contract-v3.schema.json'
    )
  })

  it('covers every method of the closed surface with a params and a result schema', () => {
    const names = Object.keys(CONTRACT_V3)
    for (const method of DOT_INGRESS_METHOD_NAMES) {
      expect(names).toContain(`params.${METHOD_KEYS[method]}`)
      expect(names).toContain(`result.${METHOD_KEYS[method]}`)
    }
  })

  it('pins every request and result to contract version 3', () => {
    for (const [name, schema] of Object.entries(CONTRACT_V3)) {
      if (name.startsWith('view.') || name.startsWith('error.')) {
        continue
      }
      const json = z.toJSONSchema(schema)
      const version =
        typeof json.properties?.contractVersion === 'object'
          ? json.properties.contractVersion.const
          : undefined
      expect(version, name).toBe(3)
    }
  })

  it('freezes the error codes of version 3 in the golden file', () => {
    expect(z.toJSONSchema(CONTRACT_V3['error.code'] ?? z.never())).toMatchObject({
      enum: [...DOT_INGRESS_ERROR_CODES]
    })
  })

  it('has no objective, path, worktree, branch or model field except the submit objective', () => {
    for (const [name, schema] of Object.entries(CONTRACT_V3)) {
      const text = JSON.stringify(z.toJSONSchema(schema))
      expect(text.includes('"objective"'), name).toBe(name === 'params.submit')
      for (const field of ['"path"', '"worktree"', '"branch"', '"model"', '"baseCommit"']) {
        expect(text.includes(field), `${name} ${field}`).toBe(false)
      }
    }
  })
})
