import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseClaudeStatusLineBody } from '../../shared/claude-statusline-rate-limits'
import {
  forwardClaudeRateLimits,
  type RelayForwardPorts,
  type RelayForwardPost
} from './relay-forward'

// FIXTURE_ONLY: synthetic values; the token is the obviously fake test hex used elsewhere.
const TOKEN = '0123456789abcdef0123456789abcdef'
const PANE_KEY = 'tab-1:0f5c2a9e-3b7d-4c1e-9a2f-6d8e1b4c7a90'
const TEMP = join('/fixture', 'temp')
const RATE_LIMITS = {
  five_hour: { used_percentage: 42, resets_at: 1_790_000_000 },
  seven_day: { used_percentage: 7, resets_at: 1_790_500_000 }
}
const PAYLOAD = JSON.stringify({
  session_id: 'session-fixture',
  cwd: 'C:\\work\\private-project',
  model: { display_name: 'Opus' },
  transcript_path: 'C:\\Users\\someone\\.claude\\projects\\x.jsonl',
  rate_limits: RATE_LIMITS
})

function ports(overrides: Partial<RelayForwardPorts> = {}) {
  const files = new Map<string, string>()
  const posts: RelayForwardPost[] = []
  const base: RelayForwardPorts = {
    env: {
      ORCA_PANE_KEY: PANE_KEY,
      ORCA_AGENT_HOOK_PORT: '41234',
      ORCA_AGENT_HOOK_TOKEN: TOKEN,
      ORCA_AGENT_HOOK_ENV: 'production',
      ORCA_AGENT_HOOK_VERSION: '7'
    },
    tempDir: TEMP,
    nowSeconds: () => 1_000_000,
    readText: (path) => files.get(path) ?? null,
    writeText: (path, text) => {
      files.set(path, text)
    },
    post: async (request) => {
      posts.push(request)
    }
  }
  return { ports: { ...base, ...overrides }, files, posts }
}

function formOf(post: RelayForwardPost): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(post.body).entries())
}

describe('forwardClaudeRateLimits', () => {
  it('posts only the rate_limits part to the statusline ingest with the hook token', async () => {
    const { ports: p, posts } = ports()
    await expect(forwardClaudeRateLimits(PAYLOAD, p)).resolves.toBe('posted')
    expect(posts).toHaveLength(1)
    const [post] = posts
    expect(post).toMatchObject({ port: 41234, path: '/statusline/claude', token: TOKEN })
    const form = formOf(post)
    expect(Object.keys(form).sort()).toEqual(['configDir', 'env', 'paneKey', 'payload', 'version'])
    expect(form).toMatchObject({
      paneKey: PANE_KEY,
      configDir: '',
      env: 'production',
      version: '7'
    })
    expect(JSON.parse(form.payload)).toEqual({ rate_limits: RATE_LIMITS })
    expect(post.body).not.toContain('private-project')
    expect(post.body).not.toContain('transcript')
  })

  it('produces a body the G4 statusline ingest accepts', async () => {
    const { ports: p, posts } = ports({
      env: {
        ORCA_PANE_KEY: PANE_KEY,
        ORCA_AGENT_HOOK_PORT: '41234',
        ORCA_AGENT_HOOK_TOKEN: TOKEN,
        CLAUDE_CONFIG_DIR: 'C:\\Users\\someone\\.claude-alt'
      }
    })
    await forwardClaudeRateLimits(PAYLOAD, p)
    expect(parseClaudeStatusLineBody(formOf(posts[0]))).toEqual({
      configDir: 'C:\\Users\\someone\\.claude-alt',
      fiveHour: { used_percentage: 42, resets_at: 1_790_000_000 },
      sevenDay: { used_percentage: 7, resets_at: 1_790_500_000 }
    })
  })

  it('refreshes port and token from the endpoint file without running it', async () => {
    const endpoint = join('/fixture', 'hooks', 'endpoint.cmd')
    const {
      ports: p,
      files,
      posts
    } = ports({
      env: {
        ORCA_PANE_KEY: PANE_KEY,
        ORCA_AGENT_HOOK_PORT: '1111',
        ORCA_AGENT_HOOK_TOKEN: 'stale-token',
        ORCA_AGENT_HOOK_ENDPOINT: endpoint
      }
    })
    files.set(
      endpoint,
      `set ORCA_AGENT_HOOK_PORT=52000\r\nset ORCA_AGENT_HOOK_TOKEN=${TOKEN}\r\nset ORCA_AGENT_HOOK_ENV=dev\r\nset ORCA_AGENT_HOOK_VERSION=9\r\n`
    )
    await forwardClaudeRateLimits(PAYLOAD, p)
    expect(posts[0]).toMatchObject({ port: 52000, token: TOKEN })
    expect(formOf(posts[0])).toMatchObject({ env: 'dev', version: '9' })
  })

  it.each([
    ['a background job worker', { CLAUDE_JOB_DIR: 'C:\\jobs\\1' }, 'skipped_job'],
    ['no pane key', { ORCA_PANE_KEY: '' }, 'skipped_no_pane'],
    ['no hook port', { ORCA_AGENT_HOOK_PORT: '' }, 'skipped_no_endpoint'],
    ['a port out of range', { ORCA_AGENT_HOOK_PORT: '70000' }, 'skipped_no_endpoint'],
    ['no hook token', { ORCA_AGENT_HOOK_TOKEN: '' }, 'skipped_no_endpoint']
  ])('skips the post for %s', async (_label, env, outcome) => {
    const { ports: p, posts, files } = ports()
    const result = await forwardClaudeRateLimits(PAYLOAD, { ...p, env: { ...p.env, ...env } })
    expect(result).toBe(outcome)
    expect(posts).toHaveLength(0)
    expect(files.size).toBe(0)
  })

  it.each([
    ['no rate_limits', JSON.stringify({ model: { display_name: 'Opus' } })],
    ['rate_limits that is not an object', JSON.stringify({ rate_limits: 'full' })],
    ['text that is not JSON', 'rate_limits']
  ])('skips a payload with %s', async (_label, payload) => {
    const { ports: p, posts } = ports()
    await expect(forwardClaudeRateLimits(payload, p)).resolves.toBe('skipped_no_rate_limits')
    expect(posts).toHaveLength(0)
  })

  it("keeps Orca's 15-second per-pane throttle and stamps only a certain post", async () => {
    let now = 1_000_000
    const { ports: p, posts, files } = ports({ nowSeconds: () => now })
    await forwardClaudeRateLimits(PAYLOAD, p)
    const stamps = [...files.entries()]
    expect(stamps).toHaveLength(1)
    expect(stamps[0][0].startsWith(TEMP)).toBe(true)
    expect(stamps[0][0]).toContain('orca-claude-statusline-last-')
    expect(stamps[0][1]).toBe('1000000')

    now += 14
    await expect(forwardClaudeRateLimits(PAYLOAD, p)).resolves.toBe('skipped_throttled')
    now += 1
    await expect(forwardClaudeRateLimits(PAYLOAD, p)).resolves.toBe('posted')
    expect(posts).toHaveLength(2)
  })

  it('posts again when the stamp is malformed or in the future', async () => {
    const { ports: p, files, posts } = ports()
    await forwardClaudeRateLimits(PAYLOAD, p)
    const [stampPath] = [...files.keys()]
    files.set(stampPath, 'garbage')
    await expect(forwardClaudeRateLimits(PAYLOAD, p)).resolves.toBe('posted')
    files.set(stampPath, '2000000')
    await expect(forwardClaudeRateLimits(PAYLOAD, p)).resolves.toBe('posted')
    expect(posts).toHaveLength(3)
  })

  it('keeps the stamp file name inside the temp folder for any pane key', async () => {
    const { ports: p, files } = ports()
    await forwardClaudeRateLimits(PAYLOAD, {
      ...p,
      env: { ...p.env, ORCA_PANE_KEY: '..\\..\\escape:/x' }
    })
    const [stampPath] = [...files.keys()]
    expect(stampPath.startsWith(TEMP)).toBe(true)
    expect(stampPath.slice(TEMP.length + 1)).not.toMatch(/[\\/:]/)
  })

  it('reports a failed post without throwing when the hook server is down', async () => {
    const post = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const { ports: p } = ports({ post })
    await expect(forwardClaudeRateLimits(PAYLOAD, p)).resolves.toBe('failed')
    expect(post).toHaveBeenCalledTimes(1)
  })
})
