import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { postToHookServer } from './relay-http-post'

// FIXTURE_ONLY: an in-process fake hook server on loopback; nothing leaves the machine.
const TOKEN = '0123456789abcdef0123456789abcdef'

type Received = { method?: string; url?: string; token?: string | string[]; body: string }

let server: Server | null = null

afterEach(async () => {
  const current = server
  server = null
  if (current) {
    current.closeAllConnections()
    await new Promise<void>((resolve) => current.close(() => resolve()))
  }
})

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => resolve(body))
  })
}

async function startFakeHookServer(
  respond: (res: ServerResponse) => void
): Promise<{ port: number; received: Received[] }> {
  const received: Received[] = []
  const created = createServer((req, res) => {
    void readBody(req).then((body) => {
      received.push({
        method: req.method,
        url: req.url,
        token: req.headers['x-orca-agent-hook-token'],
        body
      })
      respond(res)
    })
  })
  server = created
  await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', () => resolve()))
  const address = created.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('the fake hook server has no port')
  }
  return { port: address.port, received }
}

describe('postToHookServer', () => {
  it('posts the form body with the hook token to the local listener', async () => {
    const { port, received } = await startFakeHookServer((res) => {
      res.writeHead(204)
      res.end()
    })
    await postToHookServer({ port, path: '/statusline/claude', token: TOKEN, body: 'a=1&b=2' })
    expect(received).toEqual([
      { method: 'POST', url: '/statusline/claude', token: TOKEN, body: 'a=1&b=2' }
    ])
  })

  it('resolves when nothing listens on the port', async () => {
    const { port } = await startFakeHookServer(() => {})
    const stopped = server
    server = null
    await new Promise<void>((resolve) => (stopped ? stopped.close(() => resolve()) : resolve()))
    await expect(
      postToHookServer({ port, path: '/statusline/claude', token: TOKEN, body: 'a=1' })
    ).resolves.toBeUndefined()
  })

  it('gives up at its deadline when the listener never answers', async () => {
    const { port } = await startFakeHookServer(() => {})
    const started = Date.now()
    await postToHookServer(
      { port, path: '/statusline/claude', token: TOKEN, body: 'a=1' },
      { timeoutMs: 100 }
    )
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
