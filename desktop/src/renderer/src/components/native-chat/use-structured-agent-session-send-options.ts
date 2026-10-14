import { useCallback } from 'react'
import { structuredAgentSessionOptionSnapshot } from '../../../../shared/structured-agent-session-options'
import { structuredAgentSessionSendSelection } from '../../../../shared/structured-agent-session-option-view'
import { getStructuredAgentSessionLaunchSelection } from '@/lib/structured-agent-session-launch-options'
import type { StructuredAgentSessionLaunchView } from './use-native-chat-provisional-launch'
import type { useStructuredAgentSessionOptionState } from './use-structured-agent-session-option-state'

/** What each send carries to a host that takes it: the model and effort the composer shows now. */
export function useStructuredAgentSessionSendOptions(
  sessionId: string,
  launch: StructuredAgentSessionLaunchView | undefined,
  source: Pick<
    ReturnType<typeof useStructuredAgentSessionOptionState>,
    'optionStateRef' | 'pendingOptionRef' | 'optionView' | 'takesSendOptions'
  >
): () => Readonly<Record<string, string>> | undefined {
  const { optionStateRef, optionView, pendingOptionRef, takesSendOptions } = source
  return useCallback(() => {
    if (!takesSendOptions) {
      return undefined
    }
    // Read, not rendered: a pick the launch just took is not in this render's props yet.
    const selection = getStructuredAgentSessionLaunchSelection(sessionId)
    // A pick on its way resolves as the picker shows it, so a gone model it names is replaced too.
    const pending = pendingOptionRef.current
    const view = optionView(optionStateRef.current, selection?.seed ?? launch?.seedOptions, {
      ...(selection?.held ?? launch?.heldOptions),
      ...(pending ? { [pending.id]: pending.value } : {})
    })
    return structuredAgentSessionSendSelection(
      view.record.agent,
      structuredAgentSessionOptionSnapshot(view)
    )
  }, [launch, optionStateRef, optionView, pendingOptionRef, sessionId, takesSendOptions])
}
