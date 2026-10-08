import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../canonical-json'
import { isEnglishText } from '../english-text'
import { DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED } from './dot-remote-defaults'
import { DOT_REMOTE_TOOL_ERROR_CODES, DOT_REMOTE_ERROR_MESSAGES } from './dot-remote-errors'
import { buildDotMcpToolManifest } from './dot-remote-manifest'
import { DOT_INGRESS_CONTRACT_V3_GOLDEN_SHA256 } from './dot-remote-contract-pins'
import { propertyNames } from './dot-remote-json-schema-walk.test-fixture'

const manifest = buildDotMcpToolManifest()
const READ_TOOLS = [
  'nash_status',
  'nash_list_workspaces',
  'nash_get_receipt',
  'nash_get_request',
  'nash_list_requests',
  'nash_list_permission_prompts',
  'nash_list_validation_decisions'
]
const WRITE_TOOLS = [
  'nash_submit_task',
  'nash_cancel_request',
  'nash_answer_permission_prompt',
  'nash_send_message_to_run',
  'nash_decide_validation'
]

function tool(name: string) {
  const found = manifest.tools.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`Missing tool ${name}`)
  }
  return found
}

describe('dot MCP tool manifest', () => {
  it('matches the golden manifest file', async () => {
    await expect(`${JSON.stringify(manifest, null, 2)}\n`).toMatchFileSnapshot(
      './dot-mcp-tool-manifest.json'
    )
  })

  it('carries the sha256 of the canonical JSON of everything else in it', () => {
    const { manifestSha256, ...rest } = manifest
    expect(manifestSha256).toBe(
      createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex')
    )
  })

  it('lists the NASH tools in a fixed order', () => {
    expect(manifest.tools.map((entry) => entry.name)).toEqual([
      'nash_status',
      'nash_list_workspaces',
      'nash_submit_task',
      'nash_get_receipt',
      'nash_get_request',
      'nash_list_requests',
      'nash_cancel_request',
      'nash_list_permission_prompts',
      ...(DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED ? ['nash_answer_permission_prompt'] : []),
      'nash_send_message_to_run',
      'nash_list_validation_decisions',
      'nash_decide_validation'
    ])
    expect(manifest.tools).toHaveLength(12)
  })

  it('describes every tool in English with object input and output schemas', () => {
    for (const entry of manifest.tools) {
      expect(isEnglishText(entry.description), entry.name).toBe(true)
      expect(entry.description.length, entry.name).toBeGreaterThan(40)
      expect(entry.inputSchema.type, entry.name).toBe('object')
      expect(entry.outputSchema.type, entry.name).toBe('object')
    }
  })

  it('marks reads read-only and writes neither read-only nor open-world', () => {
    for (const name of READ_TOOLS) {
      expect(tool(name).annotations, name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false
      })
      expect(tool(name).nash.source, name).not.toBe('inbox')
    }
    for (const name of WRITE_TOOLS) {
      expect(tool(name).annotations, name).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
        openWorldHint: false
      })
      expect(tool(name).nash.source, name).toBe('inbox')
    }
    expect(tool('nash_cancel_request').annotations.destructiveHint).toBe(true)
    expect(tool('nash_answer_permission_prompt').annotations.destructiveHint).toBe(true)
    expect(tool('nash_decide_validation').annotations.destructiveHint).toBe(true)
    expect(tool('nash_submit_task').annotations.destructiveHint).toBe(false)
  })

  it('returns a receipt from every write tool', () => {
    for (const name of WRITE_TOOLS) {
      expect(propertyNames(tool(name).outputSchema), name).toContain('itemId')
      expect(propertyNames(tool(name).outputSchema), name).toContain('state')
    }
  })

  it('maps each write tool to its v3 method and names the key it deduplicates on', () => {
    expect(tool('nash_submit_task').nash).toMatchObject({
      mapsTo: 'dotIngress.requests.submit',
      inboxKind: 'submit',
      dedupKey: 'idempotencyKey'
    })
    expect(tool('nash_cancel_request').nash).toMatchObject({
      mapsTo: 'dotIngress.requests.cancel',
      inboxKind: 'cancel',
      dedupKey: 'submitItemId'
    })
    expect(tool('nash_answer_permission_prompt').nash).toMatchObject({
      mapsTo: 'dotIngress.decisions.answer',
      inboxKind: 'permission_answer',
      dedupKey: 'decisionId'
    })
    expect(tool('nash_send_message_to_run').nash).toMatchObject({
      mapsTo: 'dotIngress.requests.message',
      inboxKind: 'message',
      dedupKey: 'messageId'
    })
    expect(tool('nash_decide_validation').nash).toMatchObject({
      mapsTo: 'dotIngress.validations.decide',
      inboxKind: 'validation_decision',
      dedupKey: 'decisionId'
    })
    expect(tool('nash_list_validation_decisions').nash).toMatchObject({
      source: 'events',
      mapsTo: null,
      inboxKind: null
    })
  })

  it('is remote contract v4 and never asks dot for contractVersion, because the MCP layer injects 3', () => {
    expect(manifest.contractVersion).toBe(4)
    expect(manifest.injected).toEqual({ contractVersion: 3 })
    for (const entry of manifest.tools) {
      expect(propertyNames(entry.inputSchema), entry.name).not.toContain('contractVersion')
      expect(propertyNames(entry.inputSchema), entry.name).not.toContain('deliverableLanguage')
    }
  })

  it('lets remote submissions ask for workspace write, read only by default (D-034)', () => {
    const access = tool('nash_submit_task').inputSchema.properties?.requestedAccess
    expect(access).toMatchObject({ enum: ['read_only', 'workspace_write'], default: 'read_only' })
    expect(manifest.policy.decided).toEqual({ submitAccessCap: 'workspace_write' })
    expect(tool('nash_submit_task').description).toContain('maxAccess')
    expect(tool('nash_submit_task').description).not.toContain('may only read')
  })

  it('tells dot the access maximum of each workspace', () => {
    expect(propertyNames(tool('nash_list_workspaces').outputSchema)).toContain('maxAccess')
    expect(tool('nash_list_workspaces').description).toContain('maxAccess')
  })

  it('pins the v3 contract golden it was generated from', () => {
    expect(manifest.contractGolden).toEqual({
      file: 'src/shared/dot-ingress/dot-ingress-contract-v3.schema.json',
      sha256: DOT_INGRESS_CONTRACT_V3_GOLDEN_SHA256
    })
  })

  it('lets nash_status show which manifest the Site serves, and nothing about the owner', () => {
    const status = tool('nash_status').outputSchema
    expect(propertyNames(status)).toContain('manifestSha256')
    expect(manifest.policy.limits).toMatchObject({ validationDecisionsOpenMax: 50 })
  })

  it('carries the defaults that await the user and the hosted rules', () => {
    expect(manifest.policy.defaults.status).toBe('awaiting_user_confirmation')
    expect(manifest.policy.defaults).not.toHaveProperty('submitAccessCap')
    for (const [name, rule] of Object.entries(manifest.rules)) {
      expect(isEnglishText(rule), name).toBe(true)
    }
    expect(Object.keys(manifest.rules)).toEqual(
      expect.arrayContaining([
        'payloadHash',
        'deduplication',
        'validationDecisions',
        'queuedCancel',
        'events',
        'revocation',
        'deviceCredential',
        'tokens'
      ])
    )
  })

  it('lists every tool error with its fixed English message', () => {
    expect(manifest.errors.map((error) => error.code)).toEqual([...DOT_REMOTE_TOOL_ERROR_CODES])
    for (const error of manifest.errors) {
      expect(error.message).toBe(DOT_REMOTE_ERROR_MESSAGES[error.code])
    }
  })

  it('has no objective in any output schema', () => {
    for (const entry of manifest.tools) {
      expect(propertyNames(entry.outputSchema), entry.name).not.toContain('objective')
    }
  })
})
