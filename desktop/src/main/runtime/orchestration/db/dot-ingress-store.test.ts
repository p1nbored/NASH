import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import {
  DotIngressStore,
  getDotIngressStore,
  type DotIngressSubmitInput
} from './dot-ingress-store'
import {
  enableFixtureInterface,
  errorCodeOf,
  FIXTURE_BINDING,
  FIXTURE_OBJECTIVE,
  fixtureTime,
  fixtureUuid,
  rawRequestColumn,
  submitInput,
  thrownTextOf
} from './dot-ingress.test-fixture'

// FIXTURE_ONLY: obviously fake credential shapes; no real token looks like this.
const FAKE_API_KEY = `sk-${'x'.repeat(24)}`
const FAKE_BEARER = `Bearer ${'x'.repeat(24)}`

describe('dot ingress request store: submit, idempotency and reads', () => {
  let owner: OrchestrationDb
  let store: DotIngressStore
  let settings: ReturnType<typeof getDotIngressSettingsStore>
  let ref: string
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ref = enableFixtureInterface(owner)
    store = getDotIngressStore(owner)
    settings = getDotIngressSettingsStore(owner)
  })
  afterEach(() => owner.close())

  const count = (table: string): unknown =>
    owner.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n
  const key = (n: number) => ({ idempotencyKey: fixtureUuid(n) })
  /** Lifts the per-minute and per-day caps so a test about something else is not stopped by them. */
  const liftCaps = () =>
    settings.setRateLimits({ ratePerMinute: 60, ratePerUtcDay: 10_000, timestamp: fixtureTime(1) })
  const submitAndLink = (
    overrides: Partial<DotIngressSubmitInput> = {},
    workbenchRequestId = 'wb-1'
  ) => {
    const { record } = store.submit(submitInput(ref, overrides))
    store.linkSubmitted({
      dotRequestId: record.dotRequestId,
      workbenchRequestId,
      timestamp: fixtureTime(20)
    })
    return record.dotRequestId
  }

  describe('submit', () => {
    it('records a received request at revision 1, with no confirmation step and no expiry', () => {
      const result = store.submit(submitInput(ref))
      expect(result.duplicate).toBe(false)
      expect(result.record).toEqual({
        dotRequestId: result.record.dotRequestId,
        sequence: 1,
        revision: 1,
        state: 'received',
        workspaceRef: ref,
        requestedAccess: 'read_only',
        deliverableLanguage: null,
        replyCorrelationId: null,
        workbenchRequestId: null,
        failureCode: null,
        createdAt: fixtureTime(10),
        updatedAt: fixtureTime(10),
        endedAt: null
      })
      expect(result.record.dotRequestId).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('hands the door caller everything it needs and nothing else', () => {
      const { record, intake } = store.submit(
        submitInput(ref, { requestedAccess: 'workspace_write', deliverableLanguage: 'zh-Hans' })
      )
      expect(intake).toEqual({
        dotRequestId: record.dotRequestId,
        workspaceRef: ref,
        workspaceId: 'fixture-repo::/fixture/repo',
        workspaceBinding: FIXTURE_BINDING,
        objective: FIXTURE_OBJECTIVE,
        requestedAccess: 'workspace_write',
        deliverableLanguage: 'zh-Hans',
        workbenchIdempotencyKey: rawRequestColumn(
          owner.db,
          record.dotRequestId,
          'workbench_idempotency_key'
        )
      })
    })

    it('never returns the objective, a workspace id or a path in the record', () => {
      const { record } = store.submit(submitInput(ref))
      const text = JSON.stringify(record)
      expect(text).not.toContain(FIXTURE_OBJECTIVE)
      expect(text).not.toContain('fixture-repo')
      expect(text).not.toContain('/fixture/repo')
      expect(Object.keys(record)).not.toContain('objective')
      expect(Object.keys(record)).not.toContain('workspaceId')
      expect(JSON.stringify(store.get(record.dotRequestId))).not.toContain(FIXTURE_OBJECTIVE)
      expect(JSON.stringify(store.list({ limit: 10 }))).not.toContain(FIXTURE_OBJECTIVE)
    })

    it('keeps the constant provenance and the app-assigned data class in the row', () => {
      const { record } = store.submit(submitInput(ref))
      const row = owner.db
        .prepare(
          'SELECT source, sender_auth, data_class, state FROM dot_ingress_requests WHERE dot_request_id = ?'
        )
        .get(record.dotRequestId)
      expect(row).toEqual({
        source: 'dot_ingress',
        sender_auth: 'ingress_token_holder',
        data_class: 'user_task_summary',
        state: 'received'
      })
    })

    describe('requested access: the dot states it, it is recorded as given and never upgraded', () => {
      it.each(['read_only', 'workspace_write'] as const)(
        'records %s exactly',
        (requestedAccess) => {
          const { record, intake } = store.submit(submitInput(ref, { requestedAccess }))
          expect(record.requestedAccess).toBe(requestedAccess)
          expect(intake?.requestedAccess).toBe(requestedAccess)
          expect(rawRequestColumn(owner.db, record.dotRequestId, 'requested_access')).toBe(
            requestedAccess
          )
        }
      )

      it('keeps read_only through every later transition, whatever else the user changed', () => {
        const id = submitAndLink({ requestedAccess: 'read_only' })
        store.cancel({ dotRequestId: id, timestamp: fixtureTime(30) })
        settings.disableWorkspace({ workspaceRef: ref, timestamp: fixtureTime(31) })
        expect(store.get(id).requestedAccess).toBe('read_only')
        expect(rawRequestColumn(owner.db, id, 'requested_access')).toBe('read_only')
      })

      it('refuses a missing or unknown level instead of choosing one', () => {
        // @ts-expect-error requestedAccess is required at this layer; the contract defaults it earlier
        const missing = () => store.submit({ ...submitInput(ref), requestedAccess: undefined })
        expect(errorCodeOf(missing)).toBe('dot_invalid_input')
        // @ts-expect-error an unknown level is not a DotRequestAccess
        const unknown = () => store.submit({ ...submitInput(ref), requestedAccess: 'admin' })
        expect(errorCodeOf(unknown)).toBe('dot_invalid_input')
        expect(count('dot_ingress_requests')).toBe(0)
      })
    })

    it('stores the language tag, reply correlation id and the claimed client as given', () => {
      const { record } = store.submit(
        submitInput(ref, {
          deliverableLanguage: 'zh-Hant-TW',
          replyCorrelationId: 'conv_1:msg/2',
          client: { name: 'dot-local', version: '0.1.0' }
        })
      )
      expect(record).toMatchObject({
        deliverableLanguage: 'zh-Hant-TW',
        replyCorrelationId: 'conv_1:msg/2'
      })
      expect(rawRequestColumn(owner.db, record.dotRequestId, 'client_name')).toBe('dot-local')
      expect(rawRequestColumn(owner.db, record.dotRequestId, 'client_version')).toBe('0.1.0')
    })

    it('computes the span count from the stored bytes and trusts no caller count', () => {
      const objective = 'Compare "alpha" with `beta` and keep \u201cgamma\u201d as is.'
      const { record } = store.submit(submitInput(ref, { objective }))
      expect(rawRequestColumn(owner.db, record.dotRequestId, 'span_count')).toBe(3)
      liftCaps()
      const plain = store.submit(submitInput(ref, { objective: 'No quotes here.', ...key(2) }))
      expect(rawRequestColumn(owner.db, plain.record.dotRequestId, 'span_count')).toBe(0)
    })

    it('stores the scan rule names the analysis found inside quoted spans', () => {
      const { record } = store.submit(
        submitInput(ref, {
          objective: 'Rename `C:\\work\\a.md` please.',
          scanRules: ['windows_absolute_path']
        })
      )
      expect(rawRequestColumn(owner.db, record.dotRequestId, 'scan_rules')).toBe(
        '["windows_absolute_path"]'
      )
    })

    it('uses a separate random key for the Workbench submit', () => {
      liftCaps()
      const first = store.submit(submitInput(ref)).record.dotRequestId
      const second = store.submit(submitInput(ref, { objective: 'Other.', ...key(2) })).record
        .dotRequestId
      const keyOf = (id: string) => rawRequestColumn(owner.db, id, 'workbench_idempotency_key')
      expect(keyOf(first)).toMatch(/^[0-9a-f-]{36}$/)
      expect(keyOf(first)).not.toBe(fixtureUuid(1))
      expect(keyOf(first)).not.toBe(keyOf(second))
    })

    it('records one received event with ids and a revision, and no text', () => {
      const { record } = store.submit(submitInput(ref))
      const events = settings.listEvents({ limit: 10 })
      expect(events[0]).toMatchObject({
        kind: 'request_received',
        dotRequestId: record.dotRequestId,
        workspaceRef: ref,
        revision: 1,
        recordedAt: fixtureTime(10)
      })
      expect(JSON.stringify(events)).not.toContain(FIXTURE_OBJECTIVE)
    })

    describe('byte-exact objective storage', () => {
      const scripts: readonly [string, string][] = [
        ['CJK', 'Summarize "\u7528\u6237\u624b\u518c.md" for the team.'],
        ['Cyrillic', 'Keep `\u041f\u0440\u0438\u0432\u0435\u0442.txt` unchanged.'],
        [
          'Arabic (right to left)',
          'Quote \u201c\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645\u201d exactly.'
        ],
        ['Hebrew', 'Keep "\u05e9\u05dc\u05d5\u05dd.docx" as named.'],
        ['Devanagari', 'Cite `\u0928\u092e\u0938\u094d\u0924\u0947.md` verbatim.'],
        [
          'emoji',
          'Keep `\u{1F600}\u{1F680}.md` and "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}" intact.'
        ],
        ['NFC', 'Name it `Caf\u00e9.md`.'],
        ['NFD', 'Name it `Cafe\u0301.md`.'],
        ['CRLF and edge whitespace', '  First line.\r\nSecond line with `x`.\r\n\t '],
        ['maximum length', 'a'.repeat(12_000)]
      ]

      it.each(scripts)(
        'keeps %s unchanged, in the row and in the door handle',
        (_label, objective) => {
          const { record, intake } = store.submit(submitInput(ref, { objective }))
          expect(rawRequestColumn(owner.db, record.dotRequestId, 'objective')).toBe(objective)
          expect(intake?.objective).toBe(objective)
        }
      )

      it('keeps NFC and NFD forms of one name as two different requests', () => {
        liftCaps()
        const nfc = store.submit(
          submitInput(ref, { objective: 'Name it `Caf\u00e9.md`.', ...key(2) })
        )
        const nfd = store.submit(
          submitInput(ref, { objective: 'Name it `Cafe\u0301.md`.', ...key(3) })
        )
        expect(nfc.record.dotRequestId).not.toBe(nfd.record.dotRequestId)
        expect(rawRequestColumn(owner.db, nfc.record.dotRequestId, 'objective')).not.toBe(
          rawRequestColumn(owner.db, nfd.record.dotRequestId, 'objective')
        )
      })
    })

    describe('rail 1: only workspaces the user enabled for dot', () => {
      it('refuses every submit while the interface is off and stores nothing', () => {
        settings.setEnabled({ enabled: false, timestamp: fixtureTime(2) })
        expect(errorCodeOf(() => store.submit(submitInput(ref)))).toBe('dot_ingress_disabled')
        expect(count('dot_ingress_requests')).toBe(0)
      })

      it('refuses a reference that was never enabled, and one the user disabled', () => {
        expect(errorCodeOf(() => store.submit(submitInput('dws_ffffffffffffffffffffffff')))).toBe(
          'dot_workspace_unknown'
        )
        settings.disableWorkspace({ workspaceRef: ref, timestamp: fixtureTime(2) })
        expect(errorCodeOf(() => store.submit(submitInput(ref)))).toBe('dot_workspace_unknown')
        expect(count('dot_ingress_requests')).toBe(0)
      })

      it('accepts the workspace again once the user enables it again, under the same reference', () => {
        settings.disableWorkspace({ workspaceRef: ref, timestamp: fixtureTime(2) })
        const again = settings.enableWorkspace({
          workspaceId: 'fixture-repo::/fixture/repo',
          workspaceBinding: FIXTURE_BINDING,
          label: 'fixture-repo',
          timestamp: fixtureTime(3)
        }).workspace.workspaceRef
        expect(again).toBe(ref)
        expect(store.submit(submitInput(ref)).duplicate).toBe(false)
      })

      it('refuses a workspace whose binding changed since the user enabled it', () => {
        expect(
          errorCodeOf(() => store.submit(submitInput(ref, { workspaceBinding: 'e'.repeat(64) })))
        ).toBe('dot_workspace_unavailable')
        expect(count('dot_ingress_requests')).toBe(0)
      })
    })

    describe('input validation', () => {
      it.each([
        ['a blank objective', { objective: '   ' }],
        ['an empty objective', { objective: '' }],
        ['a NUL character', { objective: 'a\0b' }],
        ['a lone surrogate', { objective: 'a\ud800b' }],
        ['an objective over 12,000 characters', { objective: 'a'.repeat(12_001) }],
        ['a language tag that is not canonical', { deliverableLanguage: 'zh-hant-tw' }],
        ['an invalid language tag', { deliverableLanguage: 'en_US' }],
        ['a key that is not a uuid', { idempotencyKey: 'key-1' }],
        ['a malformed workspace reference', { workspaceRef: 'repo::/x' }],
        ['a short binding', { workspaceBinding: 'abc' }],
        ['a scan rule that is not a rule name', { scanRules: ['C:\\secret.txt'] }],
        [
          'more than 16 scan rules',
          { scanRules: Array.from({ length: 17 }, (_, i) => `rule_${i}`) }
        ],
        ['a correlation id with spaces', { replyCorrelationId: 'a b' }],
        ['a client with a bad name', { client: { name: 'dot local', version: '1' } }],
        ['a malformed timestamp', { timestamp: 'now' }],
        ['an unknown field', { dataClass: 'public' }],
        ['a confirmation flag', { confirmed: true }]
      ])('refuses %s with dot_invalid_input and stores nothing', (_label, override) => {
        const before = count('dot_ingress_events')
        expect(errorCodeOf(() => store.submit({ ...submitInput(ref), ...override }))).toBe(
          'dot_invalid_input'
        )
        expect(count('dot_ingress_requests')).toBe(0)
        expect(count('dot_ingress_events')).toBe(before)
      })

      it('names the offending fields and never echoes their values', () => {
        const text = thrownTextOf(() =>
          store.submit({
            ...submitInput(ref),
            objective: '',
            idempotencyKey: 'secret-looking-value'
          })
        )
        expect(text).toContain('objective')
        expect(text).toContain('idempotencyKey')
        expect(text).not.toContain('secret-looking-value')
      })
    })

    describe('the persistence backstop (analysis already ran, nothing secret may be stored)', () => {
      it.each([
        ['an API key in prose', `Use ${FAKE_API_KEY} to log in.`],
        ['an API key inside a quoted span', `Keep \`${FAKE_API_KEY}\` as is.`],
        ['a bearer token inside double quotes', `Send "${FAKE_BEARER}" along.`],
        ['a private key header', 'Keep `-----BEGIN RSA PRIVATE KEY-----` as is.']
      ])('refuses %s with dot_requirement_rejected_content', (_label, objective) => {
        expect(errorCodeOf(() => store.submit(submitInput(ref, { objective })))).toBe(
          'dot_requirement_rejected_content'
        )
        expect(count('dot_ingress_requests')).toBe(0)
      })

      it('does not put the matched text into the error', () => {
        const text = thrownTextOf(() =>
          store.submit(submitInput(ref, { objective: `Use ${FAKE_API_KEY} to log in.` }))
        )
        expect(text).not.toBe('')
        expect(text).not.toContain(FAKE_API_KEY)
      })

      it('refuses more than 32 quoted spans with dot_requirement_too_long', () => {
        const objective = Array.from({ length: 33 }, (_, i) => `"s${i}"`).join(' and ')
        expect(errorCodeOf(() => store.submit(submitInput(ref, { objective })))).toBe(
          'dot_requirement_too_long'
        )
        const ok = Array.from({ length: 32 }, (_, i) => `"s${i}"`).join(' and ')
        expect(store.submit(submitInput(ref, { objective: ok })).duplicate).toBe(false)
      })
    })

    it('refuses to run inside a caller transaction and stores nothing', () => {
      owner.db.exec('BEGIN')
      try {
        expect(errorCodeOf(() => store.submit(submitInput(ref)))).toBe(
          'dot_transaction_unavailable'
        )
      } finally {
        owner.db.exec('ROLLBACK')
      }
      expect(count('dot_ingress_requests')).toBe(0)
    })
  })

  describe('idempotency', () => {
    it('returns the same request for the same key and bytes, with no second row or event', () => {
      const first = store.submit(submitInput(ref))
      const eventsBefore = count('dot_ingress_events')
      const again = store.submit(submitInput(ref, { timestamp: fixtureTime(60) }))
      expect(again).toEqual({ record: first.record, duplicate: true, intake: first.intake })
      expect(count('dot_ingress_requests')).toBe(1)
      expect(count('dot_ingress_events')).toBe(eventsBefore)
    })

    it('hands the unfinished intake to a replay, and stops handing it once the request is linked', () => {
      const first = store.submit(submitInput(ref))
      expect(first.intake).not.toBeNull()
      store.linkSubmitted({
        dotRequestId: first.record.dotRequestId,
        workbenchRequestId: 'wb-1',
        timestamp: fixtureTime(20)
      })
      const again = store.submit(submitInput(ref, { timestamp: fixtureTime(60) }))
      expect(again.duplicate).toBe(true)
      expect(again.intake).toBeNull()
      expect(again.record).toMatchObject({ state: 'submitted', workbenchRequestId: 'wb-1' })
    })

    it('replays with a different claimed client, which is not part of the request bytes', () => {
      const first = store.submit(submitInput(ref))
      const again = store.submit(
        submitInput(ref, {
          client: { name: 'other-client', version: '9' },
          timestamp: fixtureTime(60)
        })
      )
      expect(again.duplicate).toBe(true)
      expect(again.record.dotRequestId).toBe(first.record.dotRequestId)
    })

    it.each([
      ['objective', { objective: `${FIXTURE_OBJECTIVE} Also check the tests.` }],
      ['objective by one combining mark', { objective: `${FIXTURE_OBJECTIVE}\u0301` }],
      ['requested access', { requestedAccess: 'workspace_write' as const }],
      ['deliverable language', { deliverableLanguage: 'de' }],
      ['reply correlation id', { replyCorrelationId: 'conv-2' }]
    ])(
      'refuses the same key with a different %s as dot_idempotency_conflict',
      (_label, override) => {
        store.submit(submitInput(ref))
        expect(errorCodeOf(() => store.submit(submitInput(ref, override)))).toBe(
          'dot_idempotency_conflict'
        )
        expect(count('dot_ingress_requests')).toBe(1)
      }
    )

    it('refuses the same key for a different workspace', () => {
      store.submit(submitInput(ref))
      const other = settings.enableWorkspace({
        workspaceId: 'other::/other',
        workspaceBinding: FIXTURE_BINDING,
        label: 'other',
        timestamp: fixtureTime(2)
      }).workspace.workspaceRef
      expect(errorCodeOf(() => store.submit(submitInput(other)))).toBe('dot_idempotency_conflict')
    })

    it('replays a request whose state moved on and reports its current state', () => {
      const id = submitAndLink()
      store.cancel({ dotRequestId: id, timestamp: fixtureTime(30) })
      const again = store.submit(submitInput(ref, { timestamp: fixtureTime(40) }))
      expect(again.duplicate).toBe(true)
      expect(again.record).toMatchObject({ state: 'canceled', revision: 3 })
    })

    it('does not replay while the interface is off', () => {
      store.submit(submitInput(ref))
      settings.setEnabled({ enabled: false, timestamp: fixtureTime(20) })
      expect(
        errorCodeOf(() => store.submit(submitInput(ref, { timestamp: fixtureTime(30) })))
      ).toBe('dot_ingress_disabled')
    })
  })

  describe('get and list', () => {
    it('reads one request by its id and refuses an unknown or malformed id', () => {
      const { record } = store.submit(submitInput(ref))
      expect(store.get(record.dotRequestId)).toEqual(record)
      expect(errorCodeOf(() => store.get(fixtureUuid(99)))).toBe('dot_request_not_found')
      expect(errorCodeOf(() => store.get('request-1'))).toBe('dot_invalid_input')
    })

    it('lists newest first and pages with a before cursor', () => {
      liftCaps()
      for (let i = 0; i < 5; i += 1) {
        store.submit(
          submitInput(ref, {
            objective: `Task ${i}.`,
            ...key(10 + i),
            timestamp: fixtureTime(10 + i)
          })
        )
      }
      const first = store.list({ limit: 2 })
      expect(first.records.map((record) => record.sequence)).toEqual([5, 4])
      expect(first.nextBeforeSequence).toBe(4)
      const second = store.list({ limit: 2, beforeSequence: first.nextBeforeSequence ?? 0 })
      expect(second.records.map((record) => record.sequence)).toEqual([3, 2])
      const last = store.list({ limit: 2, beforeSequence: second.nextBeforeSequence ?? 0 })
      expect(last.records.map((record) => record.sequence)).toEqual([1])
      expect(last.nextBeforeSequence).toBeNull()
    })

    it('lists nothing for a fresh store and refuses a limit outside 1 to 100', () => {
      expect(store.list({ limit: 10 })).toEqual({ records: [], nextBeforeSequence: null })
      expect(errorCodeOf(() => store.list({ limit: 0 }))).toBe('dot_invalid_input')
      expect(errorCodeOf(() => store.list({ limit: 101 }))).toBe('dot_invalid_input')
    })
  })

  it('has no confirmation API: nothing waits for the user between a valid submit and the door', () => {
    const names = Object.getOwnPropertyNames(DotIngressStore.prototype)
    expect(names.filter((name) => /confirm|approve|reject/i.test(name))).toEqual([])
    expect(store.submit(submitInput(ref)).record.state).toBe('received')
  })
})
