import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { WORKBENCH_DOT_INGRESS_FAILURES } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { dotIngressCallErrorMessage, dotIngressFailureMessage } from './dot-ingress-messages'

function callError(code: string, message = 'RAW SERVER TEXT C:/secret/path'): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 'test', ok: false, error: { code, message } })
}

describe('dotIngressFailureMessage', () => {
  it.each(WORKBENCH_DOT_INGRESS_FAILURES)(
    'explains %s in plain English without the code',
    (code) => {
      const message = dotIngressFailureMessage(code)
      expect(message.length).toBeGreaterThan(20)
      expect(message).not.toContain(code)
      expect(message).not.toContain('_')
    }
  )

  it('names the closed endpoint for every metadata failure', () => {
    for (const code of [
      'metadata_invalid',
      'metadata_write_failed',
      'metadata_not_secured'
    ] as const) {
      expect(dotIngressFailureMessage(code)).toMatch(/closed/)
    }
  })

  it('says the endpoint could not be opened for listen_failed', () => {
    expect(dotIngressFailureMessage('listen_failed')).toMatch(/could not open/)
  })
})

describe('dotIngressCallErrorMessage', () => {
  it('reports an unregistered method as not connected in this build', () => {
    expect(dotIngressCallErrorMessage(callError('method_not_found'))).toMatch(
      /not connected in this build/
    )
  })

  it('explains the refusals a dot settings change can meet', () => {
    expect(dotIngressCallErrorMessage(callError('workbench_dot_ingress_unavailable'))).toMatch(
      /switch was saved, but the dot interface is not available in this session/
    )
    expect(dotIngressCallErrorMessage(callError('unsupported_host'))).toMatch(
      /Only local workspaces on this computer/
    )
    expect(dotIngressCallErrorMessage(callError('workbench_workspace_unavailable'))).toMatch(
      /could not confirm this workspace/
    )
    expect(dotIngressCallErrorMessage(callError('dot_workspace_unknown'))).toMatch(
      /no longer in the list/
    )
    expect(dotIngressCallErrorMessage(callError('dot_recovery_required'))).toMatch(/need recovery/)
    expect(dotIngressCallErrorMessage(callError('dot_transaction_unavailable'))).toMatch(/busy/)
    expect(dotIngressCallErrorMessage(callError('invalid_argument'))).toMatch(/refused this value/)
    expect(dotIngressCallErrorMessage(callError('dot_invalid_input'))).toMatch(/refused this value/)
    expect(dotIngressCallErrorMessage(callError('workbench_forbidden'))).toMatch(
      /Only the desktop app/
    )
  })

  it('never repeats the raw server message or an unknown code', () => {
    const message = dotIngressCallErrorMessage(callError('runtime_error'))
    expect(message).not.toContain('RAW SERVER TEXT')
    expect(message).not.toContain('runtime_error')
    expect(message).toMatch(/did not complete/)
  })

  it('reports an unreadable answer separately', () => {
    expect(dotIngressCallErrorMessage(new ZodError([]))).toMatch(/cannot read/)
  })

  it('handles a non-RPC failure without echoing it', () => {
    expect(dotIngressCallErrorMessage(new Error('socket C:/x'))).not.toContain('socket')
  })
})
