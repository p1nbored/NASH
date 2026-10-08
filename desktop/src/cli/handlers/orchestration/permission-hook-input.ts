import {
  PERMISSION_RELAY_INPUT_KEYS,
  PermissionRequestParams,
  type PermissionRequestInput
} from '../../../shared/rpc-contract/permission-relay-params'
import { permissionProviderPayload, type PermissionProvider } from './permission-provider'

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/
const CWD_MAX_CHARS = 4096

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turns the PermissionRequest hook's stdin (hooks.md: `hook_event_name`, `tool_name`, `tool_input`,
 * optional `agent_id`, `cwd`) into relay params. Only the allowlisted name fields of `tool_input`
 * are copied: file contents, edit strings, URLs and `permission_suggestions` never leave this process.
 * Returns null for anything that cannot be relayed; the terminal dialog then answers it.
 */
export function parsePermissionHookInput(
  stdin: string,
  requestSha256: string,
  waitBudgetMs: number,
  provider: PermissionProvider = 'claude'
): PermissionRequestInput | null {
  let payload: unknown
  try {
    payload = JSON.parse(stdin)
  } catch {
    return null
  }
  if (!isRecord(payload)) {
    return null
  }
  payload = permissionProviderPayload(payload, provider)
  if (!isRecord(payload)) {
    return null
  }
  const toolInput = isRecord(payload.tool_input) ? payload.tool_input : {}
  const names = Object.fromEntries(
    PERMISSION_RELAY_INPUT_KEYS.flatMap((key) => {
      const value = toolInput[key]
      return typeof value === 'string' && value.length > 0 ? [[key, value]] : []
    })
  )
  const agentId =
    typeof payload.agent_id === 'string' && IDENTIFIER.test(payload.agent_id)
      ? payload.agent_id
      : null
  const cwd =
    typeof payload.cwd === 'string' && payload.cwd.length > 0 && payload.cwd.length <= CWD_MAX_CHARS
      ? payload.cwd
      : null
  const parsed = PermissionRequestParams.safeParse({
    toolName: payload.tool_name,
    agentId,
    cwd,
    toolInput: names,
    requestSha256,
    waitBudgetMs
  })
  return parsed.success ? parsed.data : null
}
