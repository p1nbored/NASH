import type { z } from 'zod'
import { DotRemoteAckRequestSchema, DotRemoteAckResponseSchema } from './dot-remote-ack'
import { DotRemoteDeviceCredentialRecordSchema } from './dot-remote-device-credential'
import { DotRemoteEndpointErrorSchema, DotRemoteToolErrorSchema } from './dot-remote-errors'
import {
  DOT_REMOTE_EVENT_VARIANTS,
  DotRemoteEventBatchResultSchema,
  DotRemoteEventBatchSchema,
  DotRemoteEventSchema
} from './dot-remote-events'
import {
  DotRemoteInboxItemSchema,
  DotRemoteLeaseRenewRequestSchema,
  DotRemoteLeaseRenewResponseSchema,
  DotRemoteLeaseRequestSchema,
  DotRemoteLeaseResponseSchema
} from './dot-remote-inbox'
import {
  DotRemoteChallengeCreateRequestSchema,
  DotRemoteChallengeSchema,
  DotRemotePairingApprovalRequestSchema,
  DotRemotePairingApprovalResponseSchema,
  DotRemotePairingBindingSchema,
  DotRemoteRevokeRequestSchema,
  DotRemoteRevokeResponseSchema,
  DotRemoteSessionIssueRequestSchema,
  DotRemoteSessionIssueResponseSchema,
  DotRemoteSessionRenewRequestSchema,
  DotRemoteSessionRefreshRequestSchema,
  DotRemoteSessionRefreshResponseSchema,
  DotRemoteSessionRenewResponseSchema
} from './dot-remote-pairing'
import {
  DotRemoteHeartbeatRequestSchema,
  DotRemoteHeartbeatResponseSchema,
  DotRemoteStatusViewSchema,
  DotRemoteWorkspaceListRequestSchema,
  DotRemoteWorkspaceListResponseSchema,
  DotRemoteWorkspaceListViewSchema
} from './dot-remote-presence'
import { DotRemoteReceiptSchema } from './dot-remote-receipt'
import {
  DotRemoteCancelOutputSchema,
  DotRemoteRequestProjectionSchema
} from './dot-remote-tool-views'

// One golden JSON Schema file per envelope family, keyed by the name the endpoint table uses.

export const DOT_REMOTE_ENVELOPE_FAMILIES: Readonly<
  Record<string, Readonly<Record<string, z.ZodType>>>
> = {
  'dot-remote-inbox.schema.json': {
    'inbox.item': DotRemoteInboxItemSchema,
    'lease.request': DotRemoteLeaseRequestSchema,
    'lease.response': DotRemoteLeaseResponseSchema,
    'lease.renew.request': DotRemoteLeaseRenewRequestSchema,
    'lease.renew.response': DotRemoteLeaseRenewResponseSchema
  },
  'dot-remote-ack.schema.json': {
    'ack.request': DotRemoteAckRequestSchema,
    'ack.response': DotRemoteAckResponseSchema,
    'error.endpoint': DotRemoteEndpointErrorSchema
  },
  'dot-remote-receipt.schema.json': {
    receipt: DotRemoteReceiptSchema,
    'cancel.output': DotRemoteCancelOutputSchema,
    'error.tool': DotRemoteToolErrorSchema
  },
  'dot-remote-events.schema.json': {
    event: DotRemoteEventSchema,
    'event.request_status': DOT_REMOTE_EVENT_VARIANTS.request_status,
    'event.permission_prompt_opened': DOT_REMOTE_EVENT_VARIANTS.permission_prompt_opened,
    'event.permission_prompt_closed': DOT_REMOTE_EVENT_VARIANTS.permission_prompt_closed,
    'event.message_outcome': DOT_REMOTE_EVENT_VARIANTS.message_outcome,
    'event.validation_result': DOT_REMOTE_EVENT_VARIANTS.validation_result,
    'event.deliverable_summary': DOT_REMOTE_EVENT_VARIANTS.deliverable_summary,
    'event.validation_decision_pending': DOT_REMOTE_EVENT_VARIANTS.validation_decision_pending,
    'event.validation_decision_settled': DOT_REMOTE_EVENT_VARIANTS.validation_decision_settled,
    'events.request': DotRemoteEventBatchSchema,
    'events.response': DotRemoteEventBatchResultSchema,
    'view.request': DotRemoteRequestProjectionSchema
  },
  'dot-remote-presence.schema.json': {
    'heartbeat.request': DotRemoteHeartbeatRequestSchema,
    'heartbeat.response': DotRemoteHeartbeatResponseSchema,
    'workspaces.request': DotRemoteWorkspaceListRequestSchema,
    'workspaces.response': DotRemoteWorkspaceListResponseSchema,
    'view.status': DotRemoteStatusViewSchema,
    'view.workspaces': DotRemoteWorkspaceListViewSchema
  },
  'dot-remote-pairing.schema.json': {
    'challenge.request': DotRemoteChallengeCreateRequestSchema,
    'challenge.response': DotRemoteChallengeSchema,
    'approval.request': DotRemotePairingApprovalRequestSchema,
    'approval.response': DotRemotePairingApprovalResponseSchema,
    'session.issue.request': DotRemoteSessionIssueRequestSchema,
    'session.issue.response': DotRemoteSessionIssueResponseSchema,
    'session.renew.request': DotRemoteSessionRenewRequestSchema,
    'session.renew.response': DotRemoteSessionRenewResponseSchema,
    'session.refresh.request': DotRemoteSessionRefreshRequestSchema,
    'session.refresh.response': DotRemoteSessionRefreshResponseSchema,
    'revoke.request': DotRemoteRevokeRequestSchema,
    'revoke.response': DotRemoteRevokeResponseSchema,
    binding: DotRemotePairingBindingSchema,
    'credential.record': DotRemoteDeviceCredentialRecordSchema
  }
}
