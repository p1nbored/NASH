import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson } from '../canonical-json'
import {
  DOT_INGRESS_CONTRACT_V3_GOLDEN_FILE,
  DOT_INGRESS_CONTRACT_V3_GOLDEN_SHA256
} from './dot-remote-contract-pins'
import {
  DOT_REMOTE_DECIDED_POLICY,
  DOT_REMOTE_DEFAULTS_AWAITING_CONFIRMATION
} from './dot-remote-defaults'
import {
  DOT_REMOTE_ERROR_MESSAGES,
  DOT_REMOTE_ERROR_RETRYABLE,
  DOT_REMOTE_TOOL_ERROR_CODES
} from './dot-remote-errors'
import * as limits from './dot-remote-limits'
import { DOT_REMOTE_RULES } from './dot-remote-rules'
import { DOT_REMOTE_TOOLS, type DotRemoteTool } from './dot-remote-tools'

// Generates dot-mcp-tool-manifest.json, which the Site serves from. Each tool entry is an MCP tool
// definition plus a `nash` block the Site uses and never sends to MCP clients.

type JsonSchema = z.core.JSONSchema.BaseSchema

/** MCP wants an object root; a union of closed objects gets the explicit type it already implies. */
function objectRoot(schema: JsonSchema): JsonSchema {
  return schema.type === undefined && Array.isArray(schema.oneOf)
    ? { ...schema, type: 'object' }
    : schema
}

function toolEntry(tool: DotRemoteTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    // Why input io: a defaulted field such as requestedAccess is optional for dot.
    inputSchema: objectRoot(z.toJSONSchema(tool.input, { io: 'input' })),
    // Why refs: receipts repeat the refusal and timestamp schemas in every state; local $defs keep it small.
    outputSchema: objectRoot(z.toJSONSchema(tool.output, { reused: 'ref' })),
    annotations: tool.annotations,
    nash: tool.nash
  }
}

function protocolLimits() {
  return {
    leaseSeconds: limits.DOT_REMOTE_LEASE_SECONDS,
    maxItemsPerLease: limits.DOT_REMOTE_MAX_ITEMS_PER_LEASE,
    pollActiveSeconds: limits.DOT_REMOTE_POLL_ACTIVE_SECONDS,
    pollIdleSeconds: limits.DOT_REMOTE_POLL_IDLE_SECONDS,
    heartbeatSeconds: limits.DOT_REMOTE_HEARTBEAT_SECONDS,
    onlineWindowSeconds: limits.DOT_REMOTE_ONLINE_WINDOW_SECONDS,
    eventBatchMax: limits.DOT_REMOTE_EVENT_BATCH_MAX,
    projectionListMax: limits.DOT_REMOTE_PROJECTION_LIST_MAX,
    toolCallsPerMinute: limits.DOT_REMOTE_TOOL_CALLS_PER_MINUTE,
    inboxWaitingMax: limits.DOT_REMOTE_INBOX_WAITING_MAX,
    validationDecisionsOpenMax: limits.DOT_REMOTE_VALIDATION_DECISIONS_OPEN_MAX,
    sessionTtlMinutes: limits.DOT_REMOTE_SESSION_TTL_MINUTES,
    sessionRenewAfterMinutes: limits.DOT_REMOTE_SESSION_RENEW_AFTER_MINUTES,
    challengeTtlMinutes: limits.DOT_REMOTE_CHALLENGE_TTL_MINUTES,
    challengePollSeconds: limits.DOT_REMOTE_CHALLENGE_POLL_SECONDS
  }
}

export function dotRemoteManifestSha256(manifestWithoutHash: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(manifestWithoutHash), 'utf8').digest('hex')
}

export function buildDotMcpToolManifest() {
  const manifest = {
    manifestVersion: 1,
    name: 'nash-dot-remote',
    contractVersion: limits.DOT_REMOTE_CONTRACT_VERSION,
    contractGolden: {
      file: DOT_INGRESS_CONTRACT_V3_GOLDEN_FILE,
      sha256: DOT_INGRESS_CONTRACT_V3_GOLDEN_SHA256
    },
    // Why two versions: the remote contract moved to v4, while payloads still follow dot ingress v3.
    injected: { contractVersion: limits.DOT_REMOTE_PAYLOAD_CONTRACT_VERSION },
    policy: {
      defaults: DOT_REMOTE_DEFAULTS_AWAITING_CONFIRMATION,
      decided: DOT_REMOTE_DECIDED_POLICY,
      limits: protocolLimits()
    },
    rules: DOT_REMOTE_RULES,
    tools: DOT_REMOTE_TOOLS.map(toolEntry),
    errors: DOT_REMOTE_TOOL_ERROR_CODES.map((code) => ({
      code,
      message: DOT_REMOTE_ERROR_MESSAGES[code],
      retryable: DOT_REMOTE_ERROR_RETRYABLE[code]
    }))
  }
  return { ...manifest, manifestSha256: dotRemoteManifestSha256(manifest) }
}

export type DotMcpToolManifest = ReturnType<typeof buildDotMcpToolManifest>
