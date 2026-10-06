import { describe, expect, it } from 'vitest'
import { maskSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { PERMISSION_SUMMARY_MAX_CHARS } from '../orchestration/db/autopilot-run-schema-definition'
import type { PermissionRelayInput } from './permission-audience'
import {
  DESKTOP_ONLY_SUMMARY_PREFIX,
  buildPermissionSummary,
  isDesktopOnlySummary,
  redactPermissionLine
} from './permission-redaction'

// FIXTURE_ONLY: every credential-shaped value below is synthetic.
const FAKE_TOKEN = 'ghp_0123456789abcdef0123456789abcdef'
const FAKE_BEARER = '0123456789abcdef0123456789abcdef'

const codePoints = (text: string): number => Array.from(text).length
const isOneLine = (text: string): boolean => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text)

function relay(
  toolName: string,
  toolInput: PermissionRelayInput['toolInput'],
  cwd: string | null = '/fixture/repo'
): PermissionRelayInput {
  return { toolName, agentId: null, cwd, toolInput }
}

function summaryOf(input: PermissionRelayInput, desktopOnly = false): string {
  const built = buildPermissionSummary(input, desktopOnly)
  if (!built) {
    throw new Error('summary refused')
  }
  return built.summary
}

function expectStorable(summary: string): void {
  expect(maskSecretLikeText(summary)).toBe(summary)
  expect(codePoints(summary)).toBeGreaterThanOrEqual(1)
  expect(codePoints(summary)).toBeLessThanOrEqual(PERMISSION_SUMMARY_MAX_CHARS)
  expect(isOneLine(summary)).toBe(true)
}

describe('permission redaction', () => {
  it('names the tool and the command on one line', () => {
    expect(summaryOf(relay('Bash', { command: 'git status' }))).toBe('Bash: git status')
    const multi = summaryOf(relay('Bash', { command: 'cd src\n\tnpm test\r\n  && echo done' }))
    expect(multi).toBe('Bash: cd src npm test && echo done')
    expectStorable(multi)
  })

  it('masks credentials before anything is stored or shown', () => {
    const summary = summaryOf(
      relay('Bash', {
        command: `curl -H "Authorization: Bearer ${FAKE_BEARER}" https://x.example --token ${FAKE_TOKEN}`
      })
    )
    expect(summary).not.toContain(FAKE_BEARER)
    expect(summary).not.toContain(FAKE_TOKEN)
    expect(summary).toContain('[redacted]')
    expectStorable(summary)
  })

  it('shows file names relative to the working directory, and absolute ones outside it', () => {
    expect(
      summaryOf(relay('Edit', { file_path: 'C:\\Fixture\\Repo\\src\\a.ts' }, 'c:\\fixture\\repo'))
    ).toBe('Edit: src\\a.ts')
    expect(summaryOf(relay('Write', { file_path: '/fixture/repo/src/b.ts' }))).toBe(
      'Write: src/b.ts'
    )
    expect(summaryOf(relay('Write', { file_path: '/fixture/repo2/b.ts' }))).toBe(
      'Write: /fixture/repo2/b.ts'
    )
    expect(summaryOf(relay('Read', { file_path: '/elsewhere/c.ts' }, null))).toBe(
      'Read: /elsewhere/c.ts'
    )
    expect(summaryOf(relay('NotebookEdit', { notebook_path: '/fixture/repo/n.ipynb' }))).toBe(
      'NotebookEdit: n.ipynb'
    )
  })

  it('never shows search text or anything that is not a command or file name', () => {
    const grep = summaryOf(
      relay('Grep', { path: '/fixture/repo/src', pattern: 'password=hunter2xyz' })
    )
    expect(grep).toBe('Grep: in src')
    expect(summaryOf(relay('Glob', { pattern: '**/*.ts', path: '/fixture/repo/src' }))).toBe(
      'Glob: **/*.ts in src'
    )
    expect(summaryOf(relay('WebFetch', { command: 'ignored' }), true)).toBe(
      `${DESKTOP_ONLY_SUMMARY_PREFIX}WebFetch`
    )
    expect(summaryOf(relay('mcp__github__create_issue', {}), true)).toBe(
      `${DESKTOP_ONLY_SUMMARY_PREFIX}mcp__github__create_issue`
    )
  })

  it('marks desktop-only prompts at the start of the summary', () => {
    const summary = summaryOf(
      relay('Edit', { file_path: '/fixture/repo/.claude/settings.json' }),
      true
    )
    expect(summary).toBe('Desktop only. Edit: .claude/settings.json')
    expect(isDesktopOnlySummary(summary)).toBe(true)
    expect(isDesktopOnlySummary('Bash: echo Desktop only. ')).toBe(false)
  })

  it('caps a long command at 500 code points and keeps a cut command away from dot', () => {
    const built = buildPermissionSummary(
      relay('Bash', { command: `echo ${'x '.repeat(600)}` }),
      false
    )
    expect(built?.desktopOnly).toBe(true)
    expect(built?.summary.startsWith(DESKTOP_ONLY_SUMMARY_PREFIX)).toBe(true)
    expect(built?.summary.endsWith('…')).toBe(true)
    expectStorable(built?.summary ?? '')
  })

  it('counts code points, not UTF-16 units', () => {
    const built = buildPermissionSummary(
      relay('Bash', { command: `echo ${'😀'.repeat(700)}` }),
      false
    )
    expectStorable(built?.summary ?? '')
    expect((built?.summary.length ?? 0) > PERMISSION_SUMMARY_MAX_CHARS).toBe(true)
  })

  it('stays redacted when the cut falls inside a credential flag', () => {
    for (let pad = 440; pad < 500; pad += 1) {
      const command = `${'a'.repeat(pad)} --password ${FAKE_BEARER} --token=${FAKE_TOKEN} tail`
      const built = buildPermissionSummary(relay('Bash', { command }), false)
      expect(built, String(pad)).not.toBeNull()
      const summary = built?.summary ?? ''
      expect(summary).not.toContain(FAKE_BEARER.slice(0, 12))
      expect(summary).not.toContain(FAKE_TOKEN.slice(0, 12))
      expectStorable(summary)
    }
  })

  it('replaces direction overrides and lone surrogates so the line shows what will run', () => {
    const summary = summaryOf(relay('Bash', { command: 'echo safe\u202Ecod.exe \uD800 end' }))
    expect(summary).toBe('Bash: echo safe\uFFFDcod.exe \uFFFD end')
  })

  it('is idempotent: redacting a finished line changes nothing', () => {
    const lines = [
      'Bash: git status',
      `Bash: curl --token ${FAKE_TOKEN}`,
      `Bash: ${'b'.repeat(700)}`,
      'Bash: a\n b\t c',
      `Bash: x --password ${FAKE_BEARER}`
    ]
    for (const line of lines) {
      const once = redactPermissionLine(line, 486)
      expect(once).not.toBeNull()
      const twice = redactPermissionLine(once?.text ?? '', 486)
      expect(twice?.text).toBe(once?.text)
      expect(twice?.truncated).toBe(false)
      expect(maskSecretLikeText(once?.text ?? '')).toBe(once?.text)
    }
  })

  it('refuses a line that is empty once normalized', () => {
    expect(redactPermissionLine(' \n\t ', 486)).toBeNull()
  })
})
