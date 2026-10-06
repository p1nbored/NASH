import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { OrchestrationError } from '../orchestration-error'
import { getWorkbenchRequestStore, type WorkbenchRequestStore } from './workbench-request-store'
import { getWorkbenchRouteStore, WorkbenchRouteStore } from './workbench-route-store'
import {
  WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES,
  WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES
} from './workbench-route-schema-definition'
import { CLEF_MAX_BODY_BYTES } from '../../../clef/clef-request-builder-preflight'
import type { ClefSpendReservationRow } from '../../../clef/clef-spend-ledger'
import {
  routeFixturePrincipal as principal,
  routeFixtureSubmitInput as input,
  routeFixtureWorkspace as workspace
} from './workbench-route-test-fixture'

const NOW = new Date('2026-10-04T12:30:00.000Z')

function thrownCode(action: () => unknown): string | null {
  try {
    action()
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : String(error)
  }
  return null
}

describe('Workbench route store (spend and raw responses only since D-016)', () => {
  let owner: OrchestrationDb
  let requests: WorkbenchRequestStore
  let routes: WorkbenchRouteStore

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    requests = getWorkbenchRequestStore(owner)
    routes = new WorkbenchRouteStore(owner.db, () => NOW)
  })
  afterEach(() => owner.close())

  const submit = () => requests.submit(principal, input(), workspace).request
  const count = (table: string) => owner.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n
  const rawExchange = (id: string, requestBytes = 16, responseBytes = 16) => ({
    rawResponseId: id,
    requestId: null,
    spendReservationId: null,
    httpStatus: 200,
    requestBody: new Uint8Array(requestBytes),
    responseBody: new Uint8Array(responseBytes)
  })
  const reservation = (requestId: string, attempt: number): ClefSpendReservationRow => ({
    reservationId: `spend_fixture_${attempt}_${requestId}`,
    requestId,
    purpose: 'production',
    attempt,
    utcDayKey: '2026-10-04',
    priceBasisVersion: 1,
    estimatedInputTokens: 1000,
    reservedMicroUsd: 1360,
    reservedNeurons: 124,
    reservedAt: NOW.toISOString()
  })
  const reserve = (requestId: string, attempt: number) =>
    routes.spend.atomically(() => routes.spend.insertReservation(reservation(requestId, attempt)))

  it('shares one route store per orchestration owner', () => {
    expect(getWorkbenchRouteStore(owner)).toBe(getWorkbenchRouteStore(owner))
  })

  it('offers no claim, reblock, decision or outcome write, because intake no longer routes', () => {
    expect(Object.getOwnPropertyNames(WorkbenchRouteStore.prototype).sort()).toEqual([
      'constructor',
      'insertRawResponse',
      'recoverInterruptedRouting',
      'transaction'
    ])
  })

  it('stores raw exchange bytes with their hashes', () => {
    const request = submit()
    const requestBody = new TextEncoder().encode('{"model":"clef"}')
    const responseBody = new TextEncoder().encode('{"success":true}')
    const receipt = routes.insertRawResponse({
      ...rawExchange('raw_fixture_1'),
      requestId: request.requestId,
      requestBody,
      responseBody
    })
    expect(receipt).toEqual({
      rawResponseId: 'raw_fixture_1',
      requestBodySha256: createHash('sha256').update(requestBody).digest('hex'),
      responseBodySha256: createHash('sha256').update(responseBody).digest('hex')
    })
    const stored = owner.db
      .prepare('SELECT response_body, received_at FROM workbench_clef_raw_responses')
      .get()
    const storedBody = stored?.response_body
    expect(storedBody instanceof Uint8Array && Buffer.from(storedBody).toString()).toBe(
      '{"success":true}'
    )
    expect(stored?.received_at).toBe(NOW.toISOString())
    expect(() => routes.insertRawResponse(rawExchange('raw fixture'))).toThrow()
    expect(() =>
      routes.insertRawResponse({
        ...rawExchange('raw_fixture_orphan'),
        requestId: 'fixture-missing'
      })
    ).toThrow('FOREIGN KEY')
  })

  it('refuses oversized exchange bytes before hashing and writes nothing', () => {
    expect(WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES).toBe(CLEF_MAX_BODY_BYTES)
    const requestMax = WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES
    const responseMax = WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES
    expect(() =>
      routes.insertRawResponse(rawExchange('raw_fixture_big_request', requestMax + 1))
    ).toThrow()
    expect(() =>
      routes.insertRawResponse(rawExchange('raw_fixture_big_response', 16, responseMax + 1))
    ).toThrow()
    expect(count('workbench_clef_raw_responses')).toBe(0)
    routes.insertRawResponse(rawExchange('raw_fixture_at_limits', requestMax, responseMax))
    expect(count('workbench_clef_raw_responses')).toBe(1)
    const direct = owner.db.prepare(`INSERT INTO workbench_clef_raw_responses (raw_response_id,
      http_status, request_body, request_body_sha256, response_body, response_body_sha256, received_at)
      VALUES (?, 200, ?, ?, ?, ?, ?)`)
    const sha = '0'.repeat(64)
    expect(() =>
      direct.run('raw_direct_1', new Uint8Array(requestMax + 1), sha, new Uint8Array(1), sha, 'x')
    ).toThrow('CHECK')
    expect(() =>
      direct.run('raw_direct_2', new Uint8Array(1), sha, new Uint8Array(responseMax + 1), sha, 'x')
    ).toThrow('CHECK')
  })

  it('refuses every write inside an uncommitted outer transaction', () => {
    owner.db.exec('BEGIN IMMEDIATE')
    for (const action of [
      () => routes.insertRawResponse(rawExchange('raw_fixture_nested')),
      () => routes.recoverInterruptedRouting()
    ]) {
      expect(thrownCode(action)).toBe('workbench_transaction_unavailable')
    }
    expect(owner.db.isTransaction).toBe(true)
    owner.db.exec('ROLLBACK')
    expect(count('workbench_clef_raw_responses')).toBe(0)
  })

  it('releases unsettled reservations at startup and leaves every request as it was', () => {
    const received = submit()
    const launching = submit()
    requests.advance(
      principal,
      { workspaceId: workspace.workspaceId, requestId: launching.requestId, expectedRevision: 1 },
      workspace,
      { to: 'LAUNCHING' }
    )
    reserve(received.requestId, 1)
    const before = owner.db.prepare('SELECT * FROM workbench_requests ORDER BY sequence').all()
    expect(routes.recoverInterruptedRouting()).toEqual({
      blockedRequests: 0,
      unrecoveredRequests: 0,
      releasedReservations: 1
    })
    expect(owner.db.prepare('SELECT * FROM workbench_requests ORDER BY sequence').all()).toEqual(
      before
    )
    expect(routes.spend.sumSpentMicroUsd(['production'])).toBe(1360)
    expect(routes.recoverInterruptedRouting()).toEqual({
      blockedRequests: 0,
      unrecoveredRequests: 0,
      releasedReservations: 0
    })
    expect(owner.db.isTransaction).toBe(false)
  })
})
