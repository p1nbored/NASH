import { describe, expect, it } from 'vitest'
import { describeOrcadSecretProtectionGap } from './orcad-secret-protection-gap'

describe('describeOrcadSecretProtectionGap', () => {
  it('names the keychain orcad does not use instead of claiming the host has none', () => {
    expect(describeOrcadSecretProtectionGap('darwin')).toContain('the macOS Keychain')
    expect(describeOrcadSecretProtectionGap('win32')).toContain('Windows credential protection')
    expect(describeOrcadSecretProtectionGap('linux')).toContain('the OS keyring')
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(describeOrcadSecretProtectionGap(platform)).not.toContain('has no OS keyring')
    }
  })
})
