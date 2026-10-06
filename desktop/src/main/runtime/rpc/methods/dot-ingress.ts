import {
  DotCancelParams,
  DotDecisionAnswerParams,
  DotDecisionsListParams,
  DotHelloParams,
  DotListParams,
  DotStatusParams,
  DotSubmitParams,
  DotWorkspacesParams
} from '../../../../shared/dot-ingress/dot-ingress-params'
import { DotMessageParams } from '../../../../shared/dot-ingress/dot-ingress-message'
import {
  DotCancelParamsV2,
  DotDecisionAnswerParamsV2,
  DotDecisionsListParamsV2,
  DotHelloParamsV2,
  DotListParamsV2,
  DotStatusParamsV2,
  DotSubmitParamsV2,
  DotWorkspacesParamsV2
} from '../../../../shared/dot-ingress/dot-ingress-v2'
import {
  DotCancelParamsV3,
  DotDecisionAnswerParamsV3,
  DotDecisionsListParamsV3,
  DotHelloParamsV3,
  DotListParamsV3,
  DotMessageParamsV3,
  DotStatusParamsV3,
  DotSubmitParamsV3,
  DotWorkspacesParamsV3
} from '../../../../shared/dot-ingress/dot-ingress-v3'
import { requireDotIngressCaller } from '../../dot-ingress/dot-ingress-caller'
import { cancelDotRequest } from '../../dot-ingress/dot-ingress-cancel'
import {
  answerDotDecision,
  listDotDecisions
} from '../../dot-ingress/dot-ingress-decisions-service'
import { helloResultV1, helloResultV2, helloResultV3 } from '../../dot-ingress/dot-ingress-hello'
import { submitDotRequest } from '../../dot-ingress/dot-ingress-intake'
import { sendDotMessage } from '../../dot-ingress/dot-ingress-message-service'
import { requireDotInterfaceOn } from '../../dot-ingress/dot-ingress-refusals'
import { dotIngressServiceDeps } from '../../dot-ingress/dot-ingress-runtime-deps'
import {
  answerInVersion,
  DotVersionedParamsSchema,
  parseDotCall,
  parseDotCallFromV2
} from '../../dot-ingress/dot-ingress-versioned-params'
import {
  cancelResult,
  decisionAnswerResult,
  decisionsListResult,
  listResult,
  messageResult,
  statusResult,
  submitResult,
  workspacesResult
} from '../../dot-ingress/dot-ingress-views'
import { getDotIngressSettingsStore } from '../../orchestration/db/dot-ingress-settings-store'
import { getDotIngressStore } from '../../orchestration/db/dot-ingress-store'
import { defineMethod, type RpcContext } from '../core'
import { DOT_INGRESS_VALIDATION_RPC_METHODS } from './dot-ingress-validations'

/** The caller check runs first, before params, the database or any service is touched. */
function dotCall(context: RpcContext) {
  requireDotIngressCaller(context.dotIngressCaller)
  return context
}

const params = DotVersionedParamsSchema

/**
 * The closed dot surface (contract versions 1, 2 and 3), served only on the dedicated ingress endpoint.
 * It is never spread into ALL_RPC_METHODS: the CLI-token path, mobile and remote clients must not see
 * these names, and the ingress dispatcher must not see any other. Every method is unary.
 * A refusal is answered in the version the call named: a caller never sees a newer version's code.
 */
export const DOT_INGRESS_RPC_METHODS = [
  defineMethod({
    name: 'dotIngress.hello',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotHelloParams,
          v2: DotHelloParamsV2,
          v3: DotHelloParamsV3
        })
        // Passive: a probe must not start the old federation or coordinator delivery pumps.
        const db = context.runtime.getOrchestrationDb({ passive: true })
        const settings = getDotIngressSettingsStore(db).getSettings()
        const registered = DOT_INGRESS_RPC_METHODS.map((method) => method.name)
        if (call.version === 1) {
          return helloResultV1(settings)
        }
        return call.version === 2
          ? helloResultV2(settings, registered)
          : helloResultV3(settings, registered)
      })
  }),
  defineMethod({
    name: 'dotIngress.workspaces.list',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotWorkspacesParams,
          v2: DotWorkspacesParamsV2,
          v3: DotWorkspacesParamsV3
        })
        const db = context.runtime.getOrchestrationDb({ passive: true })
        requireDotInterfaceOn(db)
        return workspacesResult(db, call.version)
      })
  }),
  defineMethod({
    name: 'dotIngress.requests.submit',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, async () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotSubmitParams,
          v2: DotSubmitParamsV2,
          v3: DotSubmitParamsV3
        })
        const deps = dotIngressServiceDeps(context.runtime)
        return submitResult(deps.db, call.version, await submitDotRequest(deps, call.params))
      })
  }),
  defineMethod({
    name: 'dotIngress.requests.status',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotStatusParams,
          v2: DotStatusParamsV2,
          v3: DotStatusParamsV3
        })
        const db = context.runtime.getOrchestrationDb({ passive: true })
        requireDotInterfaceOn(db)
        return statusResult(db, call.version, getDotIngressStore(db).get(call.params.dotRequestId))
      })
  }),
  defineMethod({
    name: 'dotIngress.requests.list',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotListParams,
          v2: DotListParamsV2,
          v3: DotListParamsV3
        })
        const db = context.runtime.getOrchestrationDb({ passive: true })
        requireDotInterfaceOn(db)
        const { limit, beforeSequence } = call.params
        const page = getDotIngressStore(db).list(
          beforeSequence ? { limit, beforeSequence } : { limit }
        )
        return listResult(db, call.version, page)
      })
  }),
  defineMethod({
    name: 'dotIngress.requests.cancel',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, async () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotCancelParams,
          v2: DotCancelParamsV2,
          v3: DotCancelParamsV3
        })
        const deps = dotIngressServiceDeps(context.runtime)
        const outcome = await cancelDotRequest(deps, call.params.dotRequestId)
        return cancelResult(deps.db, call.version, outcome)
      })
  }),
  defineMethod({
    name: 'dotIngress.requests.message',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, async () => {
        dotCall(context)
        const call = parseDotCallFromV2('dotIngress.requests.message', raw, {
          v2: DotMessageParams,
          v3: DotMessageParamsV3
        })
        const { dotRequestId, messageId, text } = call.params
        const delivery = await sendDotMessage(dotIngressServiceDeps(context.runtime), {
          dotRequestId,
          messageId,
          text
        })
        return messageResult(call.version, { dotRequestId, messageId }, delivery)
      })
  }),
  defineMethod({
    name: 'dotIngress.decisions.list',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotDecisionsListParams,
          v2: DotDecisionsListParamsV2,
          v3: DotDecisionsListParamsV3
        })
        const deps = dotIngressServiceDeps(context.runtime)
        const { dotRequestId, limit } = call.params
        const entries = listDotDecisions(deps, dotRequestId ? { dotRequestId, limit } : { limit })
        return decisionsListResult(deps.db, call.version, entries)
      })
  }),
  defineMethod({
    name: 'dotIngress.decisions.answer',
    params,
    handler: (raw, context) =>
      answerInVersion(raw, () => {
        dotCall(context)
        const call = parseDotCall(raw, {
          v1: DotDecisionAnswerParams,
          v2: DotDecisionAnswerParamsV2,
          v3: DotDecisionAnswerParamsV3
        })
        const deps = dotIngressServiceDeps(context.runtime)
        const { decisionId, decision } = call.params
        const answer = answerDotDecision(deps, { decisionId, decision })
        return decisionAnswerResult(deps.db, call.version, answer)
      })
  }),
  ...DOT_INGRESS_VALIDATION_RPC_METHODS
]
