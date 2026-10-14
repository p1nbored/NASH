import { clearDirectSshTerminalBindings } from '../slices/direct-ssh-terminal-recovery'
import type { TerminalSlice, TerminalStoreGet, TerminalStoreSet } from './terminal-state'
import { resolveDirectSshTerminalKeys } from './terminal-pty-identities'

export function createDirectSshTerminalBindingActions(
  set: TerminalStoreSet,
  _get: TerminalStoreGet
): Pick<TerminalSlice, 'clearDirectSshTargetPtyBindings'> {
  return {
    clearDirectSshTargetPtyBindings: (targetId) => {
      let clearedCount = 0
      set((s) => {
        const result = clearDirectSshTerminalBindings(s, resolveDirectSshTerminalKeys(s, targetId))
        clearedCount = result.clearedCount
        return result.patch ?? s
      })
      return clearedCount
    }
  }
}
