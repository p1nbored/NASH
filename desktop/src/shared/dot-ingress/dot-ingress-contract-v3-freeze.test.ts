import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DOT_INGRESS_ERROR_CODES_V3 } from './dot-ingress-errors-v3'
import {
  DotCancelParamsV3,
  DotCancelResultV3Schema,
  DotDecisionAnswerParamsV3,
  DotDecisionAnswerResultV3Schema,
  DotDecisionsListParamsV3,
  DotDecisionsListResultV3Schema,
  DotDecisionViewV3Schema,
  DotHelloParamsV3,
  DotHelloResultV3Schema,
  DotListParamsV3,
  DotListResultV3Schema,
  DotMessageParamsV3,
  DotMessageResultV3Schema,
  DotRequestViewV3Schema,
  DotStatusParamsV3,
  DotStatusResultV3Schema,
  DotSubmitParamsV3,
  DotSubmitResultV3Schema,
  DotWorkspacesParamsV3,
  DotWorkspacesResultV3Schema
} from './dot-ingress-v3'
import {
  DotValidationDecideParamsV3,
  DotValidationDecideResultV3Schema,
  DotValidationsListParamsV3,
  DotValidationsListResultV3Schema,
  DotValidationViewSchema
} from './dot-ingress-validation'
import { DOT_INGRESS_METHOD_NAMES } from './dot-ingress-versions'

// Contract freeze for version 3 (G7): version 2 pinned to 3 plus the validation decisions the user
// allowed dot to see and decide ("Title, reason, summary"). Versions 1 and 2 stay byte-frozen.
const CONTRACT_V3: Readonly<Record<string, z.ZodType>> = {
  'params.hello': DotHelloParamsV3,
  'params.workspaces': DotWorkspacesParamsV3,
  'params.submit': DotSubmitParamsV3,
  'params.status': DotStatusParamsV3,
  'params.list': DotListParamsV3,
  'params.cancel': DotCancelParamsV3,
  'params.message': DotMessageParamsV3,
  'params.decisions.list': DotDecisionsListParamsV3,
  'params.decisions.answer': DotDecisionAnswerParamsV3,
  'params.validations.list': DotValidationsListParamsV3,
  'params.validations.decide': DotValidationDecideParamsV3,
  'result.hello': DotHelloResultV3Schema,
  'result.workspaces': DotWorkspacesResultV3Schema,
  'result.submit': DotSubmitResultV3Schema,
  'result.status': DotStatusResultV3Schema,
  'result.list': DotListResultV3Schema,
  'result.cancel': DotCancelResultV3Schema,
  'result.message': DotMessageResultV3Schema,
  'result.decisions.list': DotDecisionsListResultV3Schema,
  'result.decisions.answer': DotDecisionAnswerResultV3Schema,
  'result.validations.list': DotValidationsListResultV3Schema,
  'result.validations.decide': DotValidationDecideResultV3Schema,
  'view.request': DotRequestViewV3Schema,
  'view.decision': DotDecisionViewV3Schema,
  'view.validation': DotValidationViewSchema,
  // The closed error list of version 3: version 2's codes, then the one version 3 adds.
  'error.code': z.enum(DOT_INGRESS_ERROR_CODES_V3)
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
      enum: [...DOT_INGRESS_ERROR_CODES_V3]
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
