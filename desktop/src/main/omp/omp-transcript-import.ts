import { homedir } from 'node:os'
import { resolveOmpSessionsDir } from '../ai-vault/omp-session-root'
import type { StructuredAgentTranscriptImport } from '../native-chat/structured-agent-cli-conversations'
import { findOmpSessionByCwd } from './omp-session-cwd-lookup'

export const OMP_TRANSCRIPT_IMPORT: StructuredAgentTranscriptImport = {
  accountHomeCandidates: ({ selectedAccountHomePath }) => [selectedAccountHomePath],
  // Where OMP itself keeps the account's sessions, which is not always under it (XDG_DATA_HOME).
  findTranscript: async ({ providerSessionId, accountHomePath, launchEnv, workspaceCwd }) => {
    const homeDir =
      (process.platform === 'win32' ? launchEnv.USERPROFILE : launchEnv.HOME) || homedir()
    const sessionsDir = resolveOmpSessionsDir({
      env: { ...launchEnv, PI_CODING_AGENT_DIR: accountHomePath },
      homeDir
    })
    return sessionsDir
      ? findOmpSessionByCwd({
          sessionsDir,
          sessionId: providerSessionId,
          cwd: workspaceCwd,
          homeDir,
          env: launchEnv
        })
      : null
  }
}
