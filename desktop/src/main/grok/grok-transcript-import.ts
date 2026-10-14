import { join } from 'node:path'
import { findGrokChatHistoryByCwd, resolveGrokHomeDir } from '../../shared/grok-session-paths'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import type { StructuredAgentTranscriptImport } from '../native-chat/structured-agent-cli-conversations'

export const GROK_TRANSCRIPT_IMPORT: StructuredAgentTranscriptImport = {
  // The chat's own home, then the one Session History lists Grok's conversations from.
  accountHomeCandidates: ({ selectedAccountHomePath }) => [
    selectedAccountHomePath,
    resolveGrokHomeDir()
  ],
  findTranscript: async ({ providerSessionId, accountHomePath, workspaceCwd }) => {
    const sessionsDir = join(accountHomePath, 'sessions')
    return (
      (await findGrokChatHistoryByCwd({
        sessionId: providerSessionId,
        cwd: workspaceCwd,
        sessionsDir
      })) ?? resolveSessionFilePath('grok', providerSessionId, { grokSessionsDir: sessionsDir })
    )
  }
}
