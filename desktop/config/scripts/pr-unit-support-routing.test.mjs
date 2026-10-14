import { describe, expect, it } from 'vitest'
import { classifyPrJobs } from './pr-code-change-scope.mjs'
import { selectPrE2eSpecs } from './pr-e2e-source-routing.mjs'

const harness = 'src/renderer/src/runtime/web-session-tabs-sync-test-harness.ts'
const structuredSessionHarness =
  'src/renderer/src/components/native-chat/NativeChatStructuredSession.test-harness.tsx'

describe('unit support routing', () => {
  it.each([harness, structuredSessionHarness])(
    'keeps unit checks and lint while excluding packaging for %s',
    (unitHarness) => {
      const result = classifyPrJobs([unitHarness])
      expect(result.should_run).toBe(true)
      expect(result.static_analysis).toBe(true)
      expect(result.typecheck).toBe(true)
      expect(result.test).toBe(true)
      expect(result.package).toBe(false)
      expect(result.package_windows).toBe(false)
    }
  )

  it.each([harness, structuredSessionHarness])(
    'retains packaging for unknown helpers and mixed product changes with %s',
    (unitHarness) => {
      for (const file of [
        'src/renderer/src/runtime/web-session-tabs-sync-next-test-harness.ts',
        'src/renderer/src/runtime/web-session-tabs-sync/snapshot-api.ts',
        'src/renderer/src/components/native-chat/NativeChatStructuredSession.next-test-harness.tsx',
        'src/renderer/src/components/native-chat/NativeChatStructuredSession.tsx',
        'src/main/providers/windows-conpty-wide-char-duplication.node-pty.test.ts',
        'src/main/browser/browser-route-tcp-egress.electron.test.ts'
      ]) {
        const result = classifyPrJobs([unitHarness, file])
        expect(result.should_run, file).toBe(true)
        expect(result.test, file).toBe(true)
        expect(result.package, file).toBe(
          file !== 'src/main/providers/windows-conpty-wide-char-duplication.node-pty.test.ts'
        )
        expect(result.package_windows, file).toBe(true)
      }
    }
  )

  it('does not turn the exact unit harness into a two-app E2E', () => {
    expect(selectPrE2eSpecs([harness])).toEqual([])
  })

  it('retains E2E selection for unknown helpers, product changes and selected specs', () => {
    const spec = 'tests/e2e/paired-client-hosted-browser-restart-survival.spec.ts'
    for (const file of [
      'src/renderer/src/runtime/web-session-tabs-sync-next-test-harness.ts',
      'src/renderer/src/runtime/web-session-tabs-sync/snapshot-api.ts',
      spec
    ]) {
      expect(selectPrE2eSpecs([harness, file]), file).toContain(spec)
    }
  })
})
