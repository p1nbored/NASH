import { useEffect, useSyncExternalStore } from 'react'
import {
  readNashSetupSignalState,
  refreshNashSetupSignals,
  subscribeNashSetupSignalState,
  type NashSetupSignalState
} from './nash-setup-signal-cache'

/** The NASH checklist signals; refreshed on mount and when the window regains focus. */
export function useNashSetupSignals(enabled: boolean): NashSetupSignalState {
  const state = useSyncExternalStore(
    subscribeNashSetupSignalState,
    readNashSetupSignalState,
    readNashSetupSignalState
  )

  useEffect(() => {
    if (!enabled) {
      return
    }
    const refresh = (): void => {
      void refreshNashSetupSignals()
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    // Why: Claude Code, Clef and dot are set up outside the checklist; re-read when the user returns.
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled])

  return state
}
