import { z } from 'zod'
import { DOT_DEFAULT_REQUEST_ACCESS } from '../dot-ingress/dot-ingress-limits'
import {
  DotDecisionAnswerParams,
  DotDecisionsListParams,
  DotStatusParams,
  DotSubmitParams
} from '../dot-ingress/dot-ingress-params'
import { DotMessageParams } from '../dot-ingress/dot-ingress-message'
import {
  DotValidationDecideParamsV3,
  DotValidationsListParamsV3
} from '../dot-ingress/dot-ingress-validation'
import type { DotIngressMethodName } from '../dot-ingress/dot-ingress-versions'
import {
  DOT_REMOTE_ALLOWED_SUBMIT_ACCESS,
  DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED
} from './dot-remote-defaults'
import { DOT_REMOTE_LIST_DEFAULT_LIMIT, DOT_REMOTE_LIST_MAX_LIMIT } from './dot-remote-limits'
import { DOT_REMOTE_ITEM_METHODS, type DotRemoteItemKind } from './dot-remote-payload'
import { DotRemoteStatusViewSchema, DotRemoteWorkspaceListViewSchema } from './dot-remote-presence'
import { DotRemoteCursorSchema, DotRemoteItemIdSchema } from './dot-remote-primitives'
import {
  DotRemoteAnswerReceiptSchema,
  DotRemoteMessageReceiptSchema,
  DotRemoteReceiptSchema,
  DotRemoteSubmitReceiptSchema,
  DotRemoteValidationDecisionReceiptSchema
} from './dot-remote-receipt'
import {
  DotRemoteCancelOutputSchema,
  DotRemotePromptListOutputSchema,
  DotRemoteRequestListOutputSchema,
  DotRemoteRequestProjectionSchema,
  DotRemoteValidationListOutputSchema
} from './dot-remote-tool-views'
import { DOT_REMOTE_TOOL_TEXT, type DotRemoteToolName } from './dot-remote-tool-text'

// The dot-facing MCP tools on the Site. Writes go to the inbox and return a receipt; reads come from
// what NASH last reported. Inputs reuse the v3 params without contractVersion, which the MCP layer
// injects, so no input schema is hand-written on the Site.

export type DotRemoteToolSource = 'heartbeat' | 'workspace_list' | 'receipts' | 'events' | 'inbox'

export type DotRemoteTool = {
  readonly name: DotRemoteToolName
  readonly title: string
  readonly description: string
  readonly input: z.ZodType
  readonly output: z.ZodType
  readonly annotations: {
    readonly readOnlyHint: boolean
    readonly destructiveHint: boolean
    readonly idempotentHint: boolean
    readonly openWorldHint: false
  }
  readonly nash: {
    readonly source: DotRemoteToolSource
    readonly mapsTo: DotIngressMethodName | null
    readonly inboxKind: DotRemoteItemKind | null
    /** The input field the Site deduplicates on, scoped to owner, device and tool (RG5). */
    readonly dedupKey: string | null
  }
}

const NO_CONTRACT_VERSION = { contractVersion: true } as const
const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const

function read(
  name: DotRemoteToolName,
  source: DotRemoteToolSource,
  input: z.ZodType,
  output: z.ZodType
): DotRemoteTool {
  const text = DOT_REMOTE_TOOL_TEXT[name]
  return {
    name,
    ...text,
    input,
    output,
    annotations: READ,
    nash: { source, mapsTo: null, inboxKind: null, dedupKey: null }
  }
}

function write(
  name: DotRemoteToolName,
  kind: DotRemoteItemKind,
  dedupKey: string,
  destructive: boolean,
  schemas: { input: z.ZodType; output: z.ZodType }
): DotRemoteTool {
  return {
    name,
    ...DOT_REMOTE_TOOL_TEXT[name],
    ...schemas,
    annotations: {
      readOnlyHint: false,
      destructiveHint: destructive,
      idempotentHint: true,
      openWorldHint: false
    },
    nash: { source: 'inbox', mapsTo: DOT_REMOTE_ITEM_METHODS[kind], inboxKind: kind, dedupKey }
  }
}

const NoInput = z.object({}).strict()

/**
 * Remote submissions state at most the remote access cap (D-034: workspace_write). The real limit is
 * each workspace's maximum, which NASH publishes and enforces when it admits the item.
 */
export const DotRemoteSubmitToolInputSchema = DotSubmitParams.omit(NO_CONTRACT_VERSION).extend({
  requestedAccess: z.enum(DOT_REMOTE_ALLOWED_SUBMIT_ACCESS).default(DOT_DEFAULT_REQUEST_ACCESS)
})

const PAGE = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(DOT_REMOTE_LIST_MAX_LIMIT)
    .default(DOT_REMOTE_LIST_DEFAULT_LIMIT),
  cursor: DotRemoteCursorSchema.optional()
}

const ListRequestsInput = z.object(PAGE).strict()

/** The v3 list params with the Site's page size and cursor: the Site pages what NASH reported. */
const ListValidationsInput = DotValidationsListParamsV3.omit(NO_CONTRACT_VERSION).extend(PAGE)

const answerTool = write('nash_answer_permission_prompt', 'permission_answer', 'decisionId', true, {
  input: DotDecisionAnswerParams.omit(NO_CONTRACT_VERSION),
  output: z.object({ receipt: DotRemoteAnswerReceiptSchema }).strict()
})

export const DOT_REMOTE_TOOLS: readonly DotRemoteTool[] = [
  read(
    'nash_status',
    'heartbeat',
    NoInput,
    z.object({ status: DotRemoteStatusViewSchema }).strict()
  ),
  read('nash_list_workspaces', 'workspace_list', NoInput, DotRemoteWorkspaceListViewSchema),
  write('nash_submit_task', 'submit', 'idempotencyKey', false, {
    input: DotRemoteSubmitToolInputSchema,
    output: z.object({ receipt: DotRemoteSubmitReceiptSchema }).strict()
  }),
  read(
    'nash_get_receipt',
    'receipts',
    z.object({ itemId: DotRemoteItemIdSchema }).strict(),
    z.object({ receipt: DotRemoteReceiptSchema }).strict()
  ),
  read(
    'nash_get_request',
    'events',
    DotStatusParams.omit(NO_CONTRACT_VERSION),
    z.object({ request: DotRemoteRequestProjectionSchema }).strict()
  ),
  read('nash_list_requests', 'receipts', ListRequestsInput, DotRemoteRequestListOutputSchema),
  write('nash_cancel_request', 'cancel', 'submitItemId', true, {
    input: z.object({ submitItemId: DotRemoteItemIdSchema }).strict(),
    output: DotRemoteCancelOutputSchema
  }),
  read(
    'nash_list_permission_prompts',
    'events',
    DotDecisionsListParams.omit(NO_CONTRACT_VERSION),
    DotRemotePromptListOutputSchema
  ),
  ...(DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED ? [answerTool] : []),
  write('nash_send_message_to_run', 'message', 'messageId', false, {
    input: DotMessageParams.omit(NO_CONTRACT_VERSION),
    output: z.object({ receipt: DotRemoteMessageReceiptSchema }).strict()
  }),
  read(
    'nash_list_validation_decisions',
    'events',
    ListValidationsInput,
    DotRemoteValidationListOutputSchema
  ),
  write('nash_decide_validation', 'validation_decision', 'decisionId', true, {
    input: DotValidationDecideParamsV3.omit(NO_CONTRACT_VERSION),
    output: z.object({ receipt: DotRemoteValidationDecisionReceiptSchema }).strict()
  })
]

export function dotRemoteTool(name: DotRemoteToolName): DotRemoteTool {
  const tool = DOT_REMOTE_TOOLS.find((entry) => entry.name === name)
  if (!tool) {
    throw new Error(`The tool ${name} is not offered.`)
  }
  return tool
}
