import type { z } from 'zod'
import {
  type DotRequestAccess,
  DOT_INGRESS_CONTRACT_VERSION
} from '../../shared/dot-ingress/dot-ingress-limits'
import {
  DotCancelResultSchema,
  DotHelloResultSchema,
  DotListResultSchema,
  DotStatusResultSchema,
  DotSubmitResultSchema,
  DotWorkspacesResultSchema
} from '../../shared/dot-ingress/dot-ingress-request'
import {
  DotDecisionAnswerResultSchema,
  DotDecisionsListResultSchema
} from '../../shared/dot-ingress/dot-ingress-decision'
import { DotMessageResultSchema } from '../../shared/dot-ingress/dot-ingress-message'
import {
  DotValidationDecideResultV3Schema,
  DotValidationsListResultV3Schema,
  type DotValidationDecision
} from '../../shared/dot-ingress/dot-ingress-validation'

import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { sendRequest } from '../runtime/transport'
import { RuntimeClientError, type RuntimeRpcResponse } from '../runtime/types'

/** Reads and refusals answer quickly; a submit, cancel or message may wait for the app to start or stop a run. */
export const DOT_CLI_TIMEOUT_MS = 30_000
export const DOT_CLI_LONG_TIMEOUT_MS = 180_000

export type DotRpcSend = (
  metadata: RuntimeMetadata,
  method: string,
  params: unknown,
  timeoutMs: number
) => Promise<RuntimeRpcResponse<unknown>>

/** A typed client of contract version 3 over the existing runtime transport. */
export function createDotIngressClient(metadata: RuntimeMetadata, send: DotRpcSend = sendRequest) {
  async function call<S extends z.ZodType>(
    method: string,
    params: Record<string, unknown>,
    schema: S,
    timeoutMs = DOT_CLI_TIMEOUT_MS
  ): Promise<z.output<S>> {
    const response = await send(
      metadata,
      method,
      { contractVersion: DOT_INGRESS_CONTRACT_VERSION, ...params },
      timeoutMs
    )
    if (!response.ok) {
      throw new RuntimeClientError(response.error.code, response.error.message, response.error.data)
    }
    const parsed = schema.safeParse(response.result)
    if (!parsed.success) {
      throw new RuntimeClientError(
        'invalid_runtime_response',
        'The app answered with a result outside the dot contract.'
      )
    }
    return parsed.data
  }

  return {
    hello: () => call('dotIngress.hello', {}, DotHelloResultSchema),
    workspaces: () => call('dotIngress.workspaces.list', {}, DotWorkspacesResultSchema),
    attach: (input: {
      workspaceRef: string
      coordinatorRunId: string
      objective: string
      idempotencyKey: string
      requestedAccess?: DotRequestAccess
    }) => call('dotIngress.requests.attach', input, DotSubmitResultSchema, DOT_CLI_LONG_TIMEOUT_MS),
    submit: (input: {
      workspaceRef: string
      objective: string
      idempotencyKey: string
      requestedAccess?: DotRequestAccess
    }) => call('dotIngress.requests.submit', input, DotSubmitResultSchema, DOT_CLI_LONG_TIMEOUT_MS),
    status: (dotRequestId: string) =>
      call('dotIngress.requests.status', { dotRequestId }, DotStatusResultSchema),
    list: (input: { limit?: number; beforeSequence?: number }) =>
      call('dotIngress.requests.list', input, DotListResultSchema),
    cancel: (dotRequestId: string) =>
      call(
        'dotIngress.requests.cancel',
        { dotRequestId },
        DotCancelResultSchema,
        DOT_CLI_LONG_TIMEOUT_MS
      ),
    message: (input: { dotRequestId: string; messageId: string; text: string }) =>
      call('dotIngress.requests.message', input, DotMessageResultSchema, DOT_CLI_LONG_TIMEOUT_MS),
    decisions: (input: { dotRequestId?: string; limit?: number }) =>
      call('dotIngress.decisions.list', input, DotDecisionsListResultSchema),
    answer: (input: { decisionId: string; decision: 'allow' | 'deny' }) =>
      call('dotIngress.decisions.answer', input, DotDecisionAnswerResultSchema),
    validations: (input: { dotRequestId?: string; limit?: number }) =>
      call('dotIngress.validations.list', input, DotValidationsListResultV3Schema),
    decideValidation: (input: {
      decisionId: string
      validationId: string
      decision: DotValidationDecision
    }) =>
      call(
        'dotIngress.validations.decide',
        input,
        DotValidationDecideResultV3Schema,
        DOT_CLI_LONG_TIMEOUT_MS
      )
  }
}

export type DotIngressClient = ReturnType<typeof createDotIngressClient>
