import { useEffect, useRef } from 'react'

/**
 * Calls `tick` every `intervalMs` while enabled and the document is visible. Runs, prompts and
 * their state have no push event yet (D2, D3), so the Workbench reads them again on a timer.
 */
export function useWorkbenchPoll(tick: () => void, intervalMs: number, enabled: boolean): void {
  const tickRef = useRef(tick)
  useEffect(() => {
    tickRef.current = tick
  }, [tick])
  useEffect(() => {
    if (!enabled) {
      return
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        tickRef.current()
      }
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, intervalMs])
}
