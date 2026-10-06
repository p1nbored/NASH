import { OrchestrationError } from '../runtime/orchestration/orchestration-error'

// Runs install steps in order. A step runs only when every step it needs installed; otherwise it is
// skipped and publishes nothing, so a broken part leaves its dependents refusing (fail closed).

export type InstallStepStatus = 'installed' | 'failed' | 'skipped'

export type InstallStep<Name extends string> = {
  readonly name: Name
  readonly needs: readonly Name[]
  /** The signal aborts when the step runs past its deadline: publish nothing after an await then. */
  run(signal: AbortSignal): void | Promise<void>
}

export type InstallStepRecord<Name extends string> =
  | { readonly name: Name; readonly status: 'installed' }
  | { readonly name: Name; readonly status: 'failed'; readonly code: string }
  | { readonly name: Name; readonly status: 'skipped'; readonly missing: readonly Name[] }

export type InstallRunnerOptions<Name extends string> = {
  readonly timeoutMs: number
  readonly onFailed: (name: Name, code: string) => void
  readonly onSkipped: (name: Name, missing: readonly Name[]) => void
}

export const STEP_TIMEOUT_CODE = 'step_timeout'
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/

/** A code fit for a log line: an OrchestrationError's own code, never a message. */
export function installFailureCode(error: unknown): string {
  return error instanceof OrchestrationError && SAFE_CODE.test(error.code)
    ? error.code
    : 'install_failed'
}

async function runWithDeadline(
  run: (signal: AbortSignal) => void | Promise<void>,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new OrchestrationError(STEP_TIMEOUT_CODE, 'The install step ran past its deadline.'))
    }, timeoutMs)
    timer.unref?.()
  })
  try {
    await Promise.race([Promise.resolve().then(() => run(controller.signal)), deadline])
  } finally {
    clearTimeout(timer)
  }
}

export async function runInstallSteps<Name extends string>(
  steps: readonly InstallStep<Name>[],
  options: InstallRunnerOptions<Name>
): Promise<readonly InstallStepRecord<Name>[]> {
  const records: InstallStepRecord<Name>[] = []
  const installed = new Set<Name>()
  for (const step of steps) {
    const missing = step.needs.filter((need) => !installed.has(need))
    if (missing.length > 0) {
      records.push({ name: step.name, status: 'skipped', missing })
      options.onSkipped(step.name, missing)
      continue
    }
    try {
      await runWithDeadline((signal) => step.run(signal), options.timeoutMs)
      installed.add(step.name)
      records.push({ name: step.name, status: 'installed' })
    } catch (error) {
      const code = installFailureCode(error)
      records.push({ name: step.name, status: 'failed', code })
      options.onFailed(step.name, code)
    }
  }
  return records
}
