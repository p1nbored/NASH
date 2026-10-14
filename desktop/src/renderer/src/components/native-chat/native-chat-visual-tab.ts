import type { OpenChatVisualTabState } from '../../../../shared/editor-tab-view-types'

/** One tab per visual, so opening the same visual again focuses its tab. */
export function buildChatVisualTabId(
  worktreeId: string,
  visual: Pick<OpenChatVisualTabState, 'sessionId' | 'file'>
): string {
  return `${worktreeId}::chat-visual::${visual.sessionId}::${visual.file}`
}
