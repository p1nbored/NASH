import type { z } from 'zod'
import { isDotIngressContractErrorCodeV3 } from '../../../shared/dot-ingress/dot-ingress-errors-v3'
import type { DotMessageReason } from '../../../shared/dot-ingress/dot-ingress-message'
import {
  DotCancelResultV3Schema,
  DotDecisionAnswerResultV3Schema,
  DotMessageResultV3Schema,
  DotSubmitResultV3Schema
} from '../../../shared/dot-ingress/dot-ingress-v3'
import { DotValidationDecideResultV3Schema } from '../../../shared/dot-ingress/dot-ingress-validation'
import { dotRemoteNashRefusal } from '../../../shared/dot-remote/dot-remote-errors'
import type { DotRemoteInboxItem } from '../../../shared/dot-remote/dot-remote-inbox'
import { DOT_REMOTE_ITEM_METHODS } from '../../../shared/dot-remote/dot-remote-payload'
import type { DotRemoteItemOutcome } from './dot-remote-item-journal'
import type { DotRemoteLocalEndpoint, DotRemoteLocalResult } from './dot-remote-local-endpoint'

// Hands one checked item to the local dot endpoint with its payload exactly as dot sent it (the
// contract idempotencyKey and messageId are kept as received) and turns the answer into the ack
// outcome. Only a contract dot_* code is a decision; anything else is retried later, never guessed.

/** A submit, cancel, message or validation decision may wait for the app or for git. */
export const DOT_REMOTE_LONG_DISPATCH_TIMEOUT_MS = 180_000
export const DOT_REMOTE_SHORT_DISPATCH_TIMEOUT_MS = 30_000

export type DotRemoteMessageOutcome = {
  messageId: string
  outcome: 'delivered' | 'queued' | 'refused'
  reason: DotMessageReason | null
}

export type DotRemoteDispatch =
  | {
      kind: 'decided'
      outcome: DotRemoteItemOutcome
      messageOutcome: DotRemoteMessageOutcome | null
    }
  | { kind: 'retry_later'; code: string }

export type DotRemoteDispatchContext = {
  readonly endpoint: DotRemoteLocalEndpoint
  /** The request an accepted submit item created, from the journal. */
  readonly requestOfItem: (itemId: string) => string | null
}

function decided(
  outcome: DotRemoteItemOutcome,
  messageOutcome: DotRemoteMessageOutcome | null = null
): DotRemoteDispatch {
  return { kind: 'decided', outcome, messageOutcome }
}

function admitted(dotRequestId: string, duplicate: boolean): DotRemoteItemOutcome {
  return duplicate ? { outcome: 'duplicate', dotRequestId } : { outcome: 'accepted', dotRequestId }
}

function parsed<S extends z.ZodType>(schema: S, result: unknown): z.output<S> | null {
  const value = schema.safeParse(result)
  return value.success ? value.data : null
}

/** The request a refused item concerns, as far as NASH knows it without asking anything. */
function refusedRequestOf(
  item: DotRemoteInboxItem,
  context: DotRemoteDispatchContext
): string | null {
  if (item.kind === 'cancel' || item.kind === 'message') {
    return item.payload.dotRequestId
  }
  return item.kind === 'permission_answer' || item.kind === 'validation_decision'
    ? context.requestOfItem(item.dependsOnItemId)
    : null
}

function acceptedOutcome(item: DotRemoteInboxItem, result: unknown): DotRemoteDispatch | null {
  switch (item.kind) {
    case 'submit': {
      const submit = parsed(DotSubmitResultV3Schema, result)
      return submit ? decided(admitted(submit.request.dotRequestId, submit.duplicate)) : null
    }
    case 'cancel': {
      const cancel = parsed(DotCancelResultV3Schema, result)
      return cancel ? decided(admitted(cancel.request.dotRequestId, false)) : null
    }
    case 'permission_answer': {
      const answer = parsed(DotDecisionAnswerResultV3Schema, result)
      return answer ? decided(admitted(answer.decision.dotRequestId, false)) : null
    }
    case 'message': {
      const message = parsed(DotMessageResultV3Schema, result)
      if (!message) {
        return null
      }
      const { messageId, outcome, reason } = message
      return decided(admitted(message.dotRequestId, message.duplicate), {
        messageId,
        outcome,
        reason
      })
    }
    case 'validation_decision': {
      // Why already_decided and closed are accepted too: the settled event names what happened.
      const decision = parsed(DotValidationDecideResultV3Schema, result)
      return decision ? decided(admitted(decision.dotRequestId, decision.duplicate)) : null
    }
  }
}

function outcomeOf(
  item: DotRemoteInboxItem,
  answer: DotRemoteLocalResult,
  context: DotRemoteDispatchContext
): DotRemoteDispatch {
  if (!answer.ok) {
    if (answer.kind === 'unavailable') {
      return { kind: 'retry_later', code: 'local_unavailable' }
    }
    if (!isDotIngressContractErrorCodeV3(answer.code)) {
      return { kind: 'retry_later', code: 'local_error' }
    }
    return decided({
      outcome: 'refused',
      dotRequestId: refusedRequestOf(item, context),
      refusal: dotRemoteNashRefusal(answer.code)
    })
  }
  return (
    acceptedOutcome(item, answer.result) ?? { kind: 'retry_later', code: 'local_result_invalid' }
  )
}

export async function dispatchLeasedItem(
  item: DotRemoteInboxItem,
  context: DotRemoteDispatchContext
): Promise<DotRemoteDispatch> {
  const timeoutMs =
    item.kind === 'permission_answer'
      ? DOT_REMOTE_SHORT_DISPATCH_TIMEOUT_MS
      : DOT_REMOTE_LONG_DISPATCH_TIMEOUT_MS
  const answer = await context.endpoint.call(
    DOT_REMOTE_ITEM_METHODS[item.kind],
    { ...item.payload },
    timeoutMs
  )
  return outcomeOf(item, answer, context)
}
