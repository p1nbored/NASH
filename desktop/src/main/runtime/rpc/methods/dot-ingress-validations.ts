import {
  DotValidationDecideParamsV3,
  DotValidationsListParamsV3
} from '../../../../shared/dot-ingress/dot-ingress-validation'
import { requireDotIngressCaller } from '../../dot-ingress/dot-ingress-caller'
import { dotIngressServiceDeps } from '../../dot-ingress/dot-ingress-runtime-deps'
import {
  decideDotValidation,
  listDotValidations
} from '../../dot-ingress/dot-ingress-validations-service'
import {
  answerInVersion,
  DotVersionedParamsSchema,
  parseDotCallFromV3
} from '../../dot-ingress/dot-ingress-versioned-params'
import {
  validationDecideResult,
  validationsListResult
} from '../../dot-ingress/dot-ingress-views-v3'
import { defineMethod } from '../core'

/**
 * Contract version 3 (G7): dot lists and decides the inconclusive validations of the runs it started.
 * Served only on the dedicated ingress endpoint, after the caller check; the decider is fixed to dot
 * by the service, and the params cannot name one.
 */
export const DOT_INGRESS_VALIDATION_RPC_METHODS = [
  defineMethod({
    name: 'dotIngress.validations.list',
    params: DotVersionedParamsSchema,
    handler: (raw, context) =>
      answerInVersion(raw, () => {
        requireDotIngressCaller(context.dotIngressCaller)
        const { params } = parseDotCallFromV3(
          'dotIngress.validations.list',
          raw,
          DotValidationsListParamsV3
        )
        const deps = dotIngressServiceDeps(context.runtime)
        const { dotRequestId, limit } = params
        return validationsListResult(
          listDotValidations(deps, dotRequestId ? { dotRequestId, limit } : { limit })
        )
      })
  }),
  defineMethod({
    name: 'dotIngress.validations.decide',
    params: DotVersionedParamsSchema,
    handler: (raw, context) =>
      answerInVersion(raw, async () => {
        requireDotIngressCaller(context.dotIngressCaller)
        const { params } = parseDotCallFromV3(
          'dotIngress.validations.decide',
          raw,
          DotValidationDecideParamsV3
        )
        const { decisionId, validationId, decision } = params
        const decided = await decideDotValidation(dotIngressServiceDeps(context.runtime), {
          decisionId,
          validationId,
          decision
        })
        return validationDecideResult(decided)
      })
  })
]
