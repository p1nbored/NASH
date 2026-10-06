import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DotDecisionAnswerResultSchema,
  DotDecisionsListResultSchema,
  DotDecisionViewSchema
} from './dot-ingress-decision'
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
import { DotIngressMetadataSchema } from './dot-ingress-metadata'
import { DotIngressSettingsViewSchema } from './dot-ingress-settings'

// Contract freeze: the golden file changes only on a deliberate v1 edit (or a new contract version).
const CONTRACT: Readonly<Record<string, z.ZodType>> = {
  'params.hello': DotHelloParams,
  'params.workspaces': DotWorkspacesParams,
  'params.submit': DotSubmitParams,
  'params.status': DotStatusParams,
  'params.list': DotListParams,
  'params.cancel': DotCancelParams,
  'params.decisions.list': DotDecisionsListParams,
  'params.decisions.answer': DotDecisionAnswerParams,
  'result.hello': DotHelloResultSchema,
  'result.workspaces': DotWorkspacesResultSchema,
  'result.submit': DotSubmitResultSchema,
  'result.status': DotStatusResultSchema,
  'result.list': DotListResultSchema,
  'result.cancel': DotCancelResultSchema,
  'result.decisions.list': DotDecisionsListResultSchema,
  'result.decisions.answer': DotDecisionAnswerResultSchema,
  'view.request': DotRequestViewSchema,
  'view.decision': DotDecisionViewSchema,
  'desktop.settings': DotIngressSettingsViewSchema,
  'file.metadata': DotIngressMetadataSchema
}

describe('dot ingress contract v1 freeze', () => {
  it.each(Object.entries(CONTRACT))('%s converts to JSON Schema', (_name, schema) => {
    expect(() => z.toJSONSchema(schema)).not.toThrow()
  })

  it('matches the golden JSON Schema snapshot', async () => {
    // Why one document with refs: the request view is shared by five results and would repeat in each.
    const snapshot = z.toJSONSchema(z.object(CONTRACT), { reused: 'ref' })
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(
      './dot-ingress-contract-v1.schema.json'
    )
  })

  it('covers every method of the closed ingress surface with a params and a result schema', () => {
    const names = Object.keys(CONTRACT)
    for (const method of [
      'hello',
      'workspaces',
      'submit',
      'status',
      'list',
      'cancel',
      'decisions.list',
      'decisions.answer'
    ]) {
      expect(names).toContain(`params.${method}`)
      expect(names).toContain(`result.${method}`)
    }
  })

  it('has no schema that mentions an objective field except the submit params', () => {
    for (const [name, schema] of Object.entries(CONTRACT)) {
      const text = JSON.stringify(z.toJSONSchema(schema))
      const mentionsObjective = text.includes('"objective"')
      expect(mentionsObjective, name).toBe(name === 'params.submit')
    }
  })
})
