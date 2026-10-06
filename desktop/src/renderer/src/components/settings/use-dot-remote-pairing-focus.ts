import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { moveFocusIfUnclaimed } from './dot-remote-focus'

/** Where keyboard focus belongs once a pairing action settles. */
export type DotRemotePairingFocusRequest = 'after-start' | 'after-revoke' | 'revoke-button'

export type DotRemotePairingFocus = {
  sectionRef: RefObject<HTMLElement | null>
  headingRef: RefObject<HTMLHeadingElement | null>
  codeRef: RefObject<HTMLDivElement | null>
  startRef: RefObject<HTMLButtonElement | null>
  revokeRef: RefObject<HTMLButtonElement | null>
  dialogRef: RefObject<HTMLDivElement | null>
  request: (next: DotRemotePairingFocusRequest) => void
  /** Radix would refocus a dialog trigger this panel does not have, so the panel places focus itself. */
  onDialogCloseAutoFocus: (event: Event) => void
}

/**
 * Starting a pairing or revoking one removes the button that held focus. Once the action settles,
 * focus moves to the control that replaced it, unless the user already moved focus elsewhere.
 */
export function useDotRemotePairingFocus(busy: boolean): DotRemotePairingFocus {
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const codeRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const revokeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<DotRemotePairingFocusRequest | null>(null)
  const busyRef = useRef(busy)

  const flush = useCallback((): void => {
    const pending = pendingRef.current
    // Why wait while busy: every control is disabled then, so only the heading could take focus.
    if (pending === null || busyRef.current) {
      return
    }
    pendingRef.current = null
    const targets = {
      'after-start': [codeRef.current, startRef.current],
      'after-revoke': [startRef.current, revokeRef.current],
      'revoke-button': [revokeRef.current, startRef.current]
    }[pending]
    moveFocusIfUnclaimed([...targets, headingRef.current], [sectionRef.current, dialogRef.current])
  }, [])

  useEffect(() => {
    busyRef.current = busy
    flush()
  }, [busy, flush])

  const request = useCallback((next: DotRemotePairingFocusRequest): void => {
    pendingRef.current = next
  }, [])

  const onDialogCloseAutoFocus = useCallback(
    (event: Event): void => {
      event.preventDefault()
      flush()
    },
    [flush]
  )

  return {
    sectionRef,
    headingRef,
    codeRef,
    startRef,
    revokeRef,
    dialogRef,
    request,
    onDialogCloseAutoFocus
  }
}
