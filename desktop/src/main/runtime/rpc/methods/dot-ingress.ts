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
import { requireDotIngressCaller } from '../../dot-ingress/dot-ingress-caller'
import { cancelDotRequest } from '../../dot-ingress/dot-ingress-cancel'
import {
  answerDotDecision,
  listDotDecisions
} from '../../dot-ingress/dot-ingress-decisions-service'
import { helloResult } from '../../dot-ingress/dot-ingress-hello'
import { submitDotRequest } from '../../dot-ingress/dot-ingress-intake'
import { sendDotMessage } from '../../dot-ingress/dot-ingress-message-service'
import { requireDotInterfaceOn } from '../../dot-ingress/dot-ingress-refusals'
import { dotIngressServiceDeps } from '../../dot-ingress/dot-ingress-runtime-deps'
import {
  DotVersionedParamsSchema,
  parseDotCall
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
 * The closed dot surface (contract version 3), served only on the dedicated ingress endpoint.
 * It is never spread into ALL_RPC_METHODS: the CLI-token path, mobile and remote clients must not see
 * these names, and the ingress dispatcher must not see any other. Every method is unary.
 */
export const DOT_INGRESS_RPC_METHODS = [
  defineMethod({
    name: 'dotIngress.hello',
    params,
    handler: (raw, context) => {
      dotCall(context)
      parseDotCall(raw, DotHelloParams)
      // Passive: a probe must not start the old federation or coordinator delivery pumps.
      const db = context.runtime.getOrchestrationDb({ passive: true })
      const settings = getDotIngressSettingsStore(db).getSettings()
      const registered = DOT_INGRESS_RPC_METHODS.map((method) => method.name)
      return helloResult(settings, registered)
    }
  }),
  defineMethod({
    name: 'dotIngress.workspaces.list',
    params,
    handler: (raw, context) => {
      dotCall(context)
      parseDotCall(raw, DotWorkspacesParams)
      const db = context.runtime.getOrchestrationDb({ passive: true })
      requireDotInterfaceOn(db)
      return workspacesResult(db)
    }
  }),
  defineMethod({
    name: 'dotIngress.requests.submit',
    params,
    handler: async (raw, context) => {
      dotCall(context)
      const call = parseDotCall(raw, DotSubmitParams)
      const deps = dotIngressServiceDeps(context.runtime)
      return submitResult(deps.db, await submitDotRequest(deps, call))
    }
  }),
  defineMethod({
    name: 'dotIngress.requests.status',
    params,
    handler: (raw, context) => {
      dotCall(context)
      const call = parseDotCall(raw, DotStatusParams)
      const db = context.runtime.getOrchestrationDb({ passive: true })
      requireDotInterfaceOn(db)
      return statusResult(db, getDotIngressStore(db).get(call.dotRequestId))
    }
  }),
  defineMethod({
    name: 'dotIngress.requests.list',
    params,
    handler: (raw, context) => {
      dotCall(context)
      const call = parseDotCall(raw, DotListParams)
      const db = context.runtime.getOrchestrationDb({ passive: true })
      requireDotInterfaceOn(db)
      const { limit, beforeSequence } = call
      const page = getDotIngressStore(db).list(
        beforeSequence ? { limit, beforeSequence } : { limit }
      )
      return listResult(db, page)
    }
  }),
  defineMethod({
    name: 'dotIngress.requests.cancel',
    params,
    handler: async (raw, context) => {
      dotCall(context)
      const call = parseDotCall(raw, DotCancelParams)
      const deps = dotIngressServiceDeps(context.runtime)
      const outcome = await cancelDotRequest(deps, call.dotRequestId)
      return cancelResult(deps.db, outcome)
    }
  }),
  defineMethod({
    name: 'dotIngress.requests.message',
    params,
    handler: async (raw, context) => {
      dotCall(context)
      const call = parseDotCall(raw, DotMessageParams)
      const { dotRequestId, messageId, text } = call
      const delivery = await sendDotMessage(dotIngressServiceDeps(context.runtime), {
        dotRequestId,
        messageId,
        text
      })
      return messageResult({ dotRequestId, messageId }, delivery)
    }
  }),
  defineMethod({
    name: 'dotIngress.decisions.list',
    params,
    handler: (raw, context) => {
      dotCall(context)
      const call = parseDotCall(raw, DotDecisionsListParams)
      const deps = dotIngressServiceDeps(context.runtime)
      const { dotRequestId, limit } = call
      const entries = listDotDecisions(deps, dotRequestId ? { dotRequestId, limit } : { limit })
      return decisionsListResult(deps.db, entries)
    }
  }),
  defineMethod({
    name: 'dotIngress.decisions.answer',
    params,
    handler: (raw, context) => {
      dotCall(context)
      const call = parseDotCall(raw, DotDecisionAnswerParams)
      const deps = dotIngressServiceDeps(context.runtime)
      const { decisionId, decision } = call
      const answer = answerDotDecision(deps, { decisionId, decision })
      return decisionAnswerResult(deps.db, answer)
    }
  }),
  ...DOT_INGRESS_VALIDATION_RPC_METHODS
]
