import type { RemoteInstallTransport } from './remote-install-transport'
import { execCommand } from './ssh-relay-exec-command'
import type { RemoteHostPlatform } from './ssh-remote-platform'

export function execHostCommand(
  conn: RemoteInstallTransport,
  host: RemoteHostPlatform,
  command: string,
  options?: { signal?: AbortSignal; timeoutMs?: number; onStderr?: (stderr: string) => void }
): Promise<string> {
  // Why the dialect, not the os: the wrapper is POSIX shell, so it follows the command dialect.
  return execCommand(conn, command, {
    wrapCommand: host.commandDialect !== 'powershell',
    ...options
  })
}
