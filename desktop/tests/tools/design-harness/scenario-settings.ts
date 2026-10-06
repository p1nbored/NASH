import type { PreloadApi } from '../../../src/preload/api-types'
import type { RuntimeRpcResponse } from '../../../src/shared/runtime-rpc-envelope'
import {
  createClefCredentialsFixture,
  createClefFixture,
  readClefFixtureVariant
} from './scenario-settings-clef'
import {
  createRoutingTableFixture,
  readRoutingTableFixtureVariant,
  type SettingsFixtureReply
} from './scenario-settings-routing-table'
import { createDotFixture, readDotFixtureVariant } from './scenario-settings-dot'
import { createDotRemoteFixture, readDotRemoteFixtureVariant } from './scenario-settings-dot-remote'

type RuntimeCall = PreloadApi['runtime']['call']

function envelope(reply: SettingsFixtureReply): RuntimeRpcResponse<unknown> {
  return reply.ok
    ? { id: 'fixture-rpc', ok: true, result: reply.result, _meta: { runtimeId: 'fixture-runtime' } }
    : { id: 'fixture-rpc', ok: false, error: { code: reply.code, message: reply.message } }
}

/**
 * FIXTURE_ONLY Settings answers: the Routing Table (`?routingTable=`), Clef verification
 * (`?clef=`), the dot settings (`?dot=`) and remote access (`?dotRemote=`). Methods no fixture
 * knows pass through to the wrapped runtime call.
 */
export function createSettingsScenarioFixtures(search: string): {
  clefCredentials: PreloadApi['clefCredentials']
  wrapRuntimeCall: (inner: RuntimeCall | undefined) => RuntimeCall
} {
  const clefVariant = readClefFixtureVariant(search)
  const routingTable = createRoutingTableFixture(readRoutingTableFixtureVariant(search))
  const clef = createClefFixture(clefVariant)
  const dot = createDotFixture(readDotFixtureVariant(search))
  const dotRemote = createDotRemoteFixture(readDotRemoteFixtureVariant(search))
  return {
    clefCredentials: createClefCredentialsFixture(clefVariant),
    wrapRuntimeCall: (inner) => (args) => {
      const reply =
        routingTable(args.method, args.params) ??
        clef(args.method, args.params) ??
        dot(args.method, args.params) ??
        dotRemote(args.method, args.params)
      if (reply !== null) {
        return Promise.resolve(envelope(reply))
      }
      return inner
        ? inner(args)
        : Promise.resolve(
            envelope({
              ok: false,
              code: 'fixture_unavailable',
              message: `${args.method} is not available in the design harness`
            })
          )
    }
  }
}
