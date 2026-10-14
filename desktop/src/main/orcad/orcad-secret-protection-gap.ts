// Why per platform: macOS and Windows desktops do have an OS keychain; orcad just does not use
// it, so "this host has no keyring" sent users looking for one they already had.
export function describeOrcadSecretProtectionGap(platform: NodeJS.Platform): string {
  const keychain =
    platform === 'darwin'
      ? 'the macOS Keychain'
      : platform === 'win32'
        ? 'Windows credential protection'
        : 'the OS keyring'
  return `Orca's headless server does not use ${keychain}, so credentials are stored unencrypted on this host. Pair from a desktop to manage secrets.`
}
