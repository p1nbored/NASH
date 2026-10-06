import { DOT_REMOTE_ORIGIN_MAX_CHARS } from '../../../../shared/rpc-contract/workbench-dot-remote-params'

// The same rule the main process applies before it stores an origin (an https origin with nothing
// after the host), checked here first so the screen can say which part is wrong.

export type DotRemoteOriginProblem =
  | 'empty'
  | 'too_long'
  | 'spaces'
  | 'not_a_url'
  | 'not_https'
  | 'sign_in_details'
  | 'path'

export type DotRemoteOriginCheck =
  | { ok: true; origin: string }
  | { ok: false; reason: DotRemoteOriginProblem }

function parse(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

export function checkDotRemoteOrigin(input: string): DotRemoteOriginCheck {
  const text = input.trim()
  if (text.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  if (text.length > DOT_REMOTE_ORIGIN_MAX_CHARS) {
    return { ok: false, reason: 'too_long' }
  }
  if (/\s/.test(text)) {
    return { ok: false, reason: 'spaces' }
  }
  const url = parse(text)
  if (url === null || url.hostname.length === 0) {
    return { ok: false, reason: 'not_a_url' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'not_https' }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'sign_in_details' }
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[?#]/.test(text)) {
    return { ok: false, reason: 'path' }
  }
  return { ok: true, origin: url.origin }
}
