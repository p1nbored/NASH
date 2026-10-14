import { Monitor, Server } from 'lucide-react-native'
import { parseExecutionHostId } from '../../../src/shared/execution-host'
import { colors } from '../theme/mobile-theme'

/** The desktop's own machine is a monitor, any other host a server, as on the desktop's run targets. */
export function HostKindIcon({ hostId, size }: { hostId: string | undefined; size: number }) {
  // Rows from hosts that predate hostId stamping are local: a remote row always carries one.
  const Icon = (parseExecutionHostId(hostId)?.kind ?? 'local') === 'local' ? Monitor : Server
  return <Icon size={size} color={colors.textMuted} />
}
