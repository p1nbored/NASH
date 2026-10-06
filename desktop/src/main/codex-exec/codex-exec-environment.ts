import {
  buildAgentExecEnvironment,
  type AgentExecEnvironmentInput
} from '../agent-exec-shared/exec-environment'

// The allowlist builder is shared; codex adds its saved-login directory, which is the only passthrough it needs.

export {
  isSecretLikeEnvName,
  readEnvironmentVariable,
  sanitizePathList,
  type SanitizePathOptions
} from '../agent-exec-shared/exec-environment'

/** Present for every platform; auth stays with the saved CLI login under this directory. */
const CODEX_PASSTHROUGH_DIRECTORIES = ['CODEX_HOME'] as const

export type CodexExecEnvironmentInput = Omit<AgentExecEnvironmentInput, 'passthroughDirectoryNames'>

/** Build the child environment: allowlisted names only, sanitized PATH, run-local temp. */
export function buildCodexExecEnvironment(
  input: CodexExecEnvironmentInput
): Record<string, string> {
  return buildAgentExecEnvironment({
    ...input,
    passthroughDirectoryNames: CODEX_PASSTHROUGH_DIRECTORIES
  })
}
