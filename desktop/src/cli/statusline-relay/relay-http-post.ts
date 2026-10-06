import { request } from 'node:http'
import type { RelayForwardPost } from './relay-forward'

/** Orca's statusline script gives curl `--max-time 1.5` for the same post. */
export const RELAY_POST_TIMEOUT_MS = 1_500

/**
 * One loopback post to the hook listener. Resolves on every outcome (answered, refused, unreachable
 * or past its deadline), so a stopped or stalled NASH never delays the status line further.
 */
export function postToHookServer(
  post: RelayForwardPost,
  options: { readonly timeoutMs?: number } = {}
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let deadline: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (!settled) {
        settled = true
        clearTimeout(deadline)
        resolve()
      }
    }
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        port: post.port,
        path: post.path,
        method: 'POST',
        // Why no agent: a kept-alive socket would hold the relay process open after it is done.
        agent: false,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(post.body),
          'X-Orca-Agent-Hook-Token': post.token,
          Connection: 'close'
        }
      },
      (response) => {
        response.on('error', finish)
        response.on('end', finish)
        response.resume()
      }
    )
    deadline = setTimeout(() => {
      outgoing.destroy()
      finish()
    }, options.timeoutMs ?? RELAY_POST_TIMEOUT_MS)
    outgoing.on('error', finish)
    outgoing.end(post.body)
  })
}
