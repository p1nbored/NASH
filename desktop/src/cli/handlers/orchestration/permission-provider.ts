export type PermissionProvider = 'claude' | 'codex' | 'agy'

export function isPermissionObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const AGY_TOOLS: Readonly<Record<string, string>> = {
  run_command: 'Bash',
  view_file: 'Read',
  write_to_file: 'Write',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  find_by_name: 'Glob',
  grep_search: 'Grep'
}

/** Normalize names only; patches, replacement text and file contents never cross the relay. */
export function permissionProviderPayload(
  payload: Record<string, unknown>,
  provider: PermissionProvider
): Record<string, unknown> | null {
  if (provider !== 'agy') {
    if (payload.hook_event_name !== 'PermissionRequest') {
      return null
    }
    if (
      provider === 'codex' &&
      ['exec_command', 'shell_command'].includes(String(payload.tool_name))
    ) {
      const input = isPermissionObject(payload.tool_input) ? payload.tool_input : {}
      return { ...payload, tool_name: 'Bash', tool_input: { command: input.cmd ?? input.command } }
    }
    return payload.tool_name === 'apply_patch' ? { ...payload, tool_input: {} } : payload
  }
  const call = payload.toolCall
  if (!isPermissionObject(call) || typeof call.name !== 'string') {
    return null
  }
  const args = isPermissionObject(call.args) ? call.args : {}
  const workspaces = Array.isArray(payload.workspacePaths) ? payload.workspacePaths : []
  return {
    hook_event_name: 'PermissionRequest',
    tool_name: AGY_TOOLS[call.name] ?? call.name,
    agent_id: payload.agent_id,
    cwd: args.Cwd ?? workspaces[0],
    tool_input: {
      command: args.CommandLine,
      file_path: args.AbsolutePath ?? args.TargetFile,
      path: args.SearchDirectory ?? args.SearchPath,
      pattern: args.Pattern
    }
  }
}
