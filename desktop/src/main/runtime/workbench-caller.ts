import { OrchestrationError } from './orchestration/orchestration-error'

export type WorkbenchCaller = Readonly<{ principalId: string; source: 'desktop_ui' }>
const issuedCallers = new WeakSet<WorkbenchCaller>()

/** Issued only after the main-process IPC boundary admits the trusted application renderer. */
export function issueWorkbenchDesktopCaller(): WorkbenchCaller {
  const caller: WorkbenchCaller = Object.freeze({
    principalId: 'local-desktop-ui',
    source: 'desktop_ui'
  })
  issuedCallers.add(caller)
  return caller
}

export function requireWorkbenchCaller(caller: WorkbenchCaller | undefined): WorkbenchCaller {
  if (!caller || !issuedCallers.has(caller)) {
    throw new OrchestrationError(
      'workbench_forbidden',
      'Workbench intake requires an authenticated desktop UI caller. Submission does not grant execution or approval authority.'
    )
  }
  return caller
}
