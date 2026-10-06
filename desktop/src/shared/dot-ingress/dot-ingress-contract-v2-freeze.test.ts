import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DOT_INGRESS_ERROR_CODES_V2 } from './dot-ingress-errors-v2'
import { DotMessageParams, DotMessageResultSchema } from './dot-ingress-message'
import {
  DotCancelParamsV2,
  DotCancelResultV2Schema,
  DotDecisionAnswerParamsV2,
  DotDecisionAnswerResultV2Schema,
  DotDecisionsListParamsV2,
  DotDecisionsListResultV2Schema,
  DotDecisionViewV2Schema,
  DotHelloParamsV2,
  DotHelloResultV2Schema,
  DotListParamsV2,
  DotListResultV2Schema,
  DotRequestViewV2Schema,
  DotStatusParamsV2,
  DotStatusResultV2Schema,
  DotSubmitParamsV2,
  DotSubmitResultV2Schema,
  DotWorkspacesParamsV2,
  DotWorkspacesResultV2Schema
} from './dot-ingress-v2'
import { DOT_INGRESS_V2_METHOD_NAMES } from './dot-ingress-versions'

// Contract freeze for version 2 (RG2): generated the same way as version 1, into its own golden file.
// Version 1 and its golden file stay untouched; a change here is a deliberate version 2 edit.
const CONTRACT_V2: Readonly<Record<string, z.ZodType>> = {
  'params.hello': DotHelloParamsV2,
  'params.workspaces': DotWorkspacesParamsV2,
  'params.submit': DotSubmitParamsV2,
  'params.status': DotStatusParamsV2,
  'params.list': DotListParamsV2,
  'params.cancel': DotCancelParamsV2,
  'params.message': DotMessageParams,
  'params.decisions.list': DotDecisionsListParamsV2,
  'params.decisions.answer': DotDecisionAnswerParamsV2,
  'result.hello': DotHelloResultV2Schema,
  'result.workspaces': DotWorkspacesResultV2Schema,
  'result.submit': DotSubmitResultV2Schema,
  'result.status': DotStatusResultV2Schema,
  'result.list': DotListResultV2Schema,
  'result.cancel': DotCancelResultV2Schema,
  'result.message': DotMessageResultSchema,
  'result.decisions.list': DotDecisionsListResultV2Schema,
  'result.decisions.answer': DotDecisionAnswerResultV2Schema,
  'view.request': DotRequestViewV2Schema,
  'view.decision': DotDecisionViewV2Schema,
  // The closed error list of version 2: version 1's codes, then the ones version 2 adds.
  'error.code': z.enum(DOT_INGRESS_ERROR_CODES_V2)
}

const METHOD_KEYS: Readonly<Record<(typeof DOT_INGRESS_V2_METHOD_NAMES)[number], string>> = {
  'dotIngress.hello': 'hello',
  'dotIngress.workspaces.list': 'workspaces',
  'dotIngress.requests.submit': 'submit',
  'dotIngress.requests.status': 'status',
  'dotIngress.requests.list': 'list',
  'dotIngress.requests.cancel': 'cancel',
  'dotIngress.requests.message': 'message',
  'dotIngress.decisions.list': 'decisions.list',
  'dotIngress.decisions.answer': 'decisions.answer'
}

describe('dot ingress contract v2 freeze', () => {
  it.each(Object.entries(CONTRACT_V2))('%s converts to JSON Schema', (_name, schema) => {
    expect(() => z.toJSONSchema(schema)).not.toThrow()
  })

  it('matches the golden JSON Schema snapshot', async () => {
    const snapshot = z.toJSONSchema(z.object(CONTRACT_V2), { reused: 'ref' })
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(
      './dot-ingress-contract-v2.schema.json'
    )
  })

  it('covers every method of the closed surface with a params and a result schema', () => {
    const names = Object.keys(CONTRACT_V2)
    for (const method of DOT_INGRESS_V2_METHOD_NAMES) {
      expect(names).toContain(`params.${METHOD_KEYS[method]}`)
      expect(names).toContain(`result.${METHOD_KEYS[method]}`)
    }
  })

  it('pins every schema to contract version 2', () => {
    for (const [name, schema] of Object.entries(CONTRACT_V2)) {
      if (name.startsWith('view.') || name.startsWith('error.')) {
        continue
      }
      const json = z.toJSONSchema(schema)
      const version =
        typeof json.properties?.contractVersion === 'object'
          ? json.properties.contractVersion.const
          : undefined
      expect(version, name).toBe(2)
    }
  })

  it('freezes the error codes of version 2 in the golden file', () => {
    expect(z.toJSONSchema(CONTRACT_V2['error.code'] ?? z.never())).toMatchObject({
      enum: [...DOT_INGRESS_ERROR_CODES_V2]
    })
  })

  it('has no schema that mentions an objective field except the submit params', () => {
    for (const [name, schema] of Object.entries(CONTRACT_V2)) {
      const text = JSON.stringify(z.toJSONSchema(schema))
      expect(text.includes('"objective"'), name).toBe(name === 'params.submit')
    }
  })
})
