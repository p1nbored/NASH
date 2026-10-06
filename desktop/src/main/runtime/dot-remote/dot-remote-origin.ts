// The Site origin the user pastes. Only an https origin is accepted: no other scheme, no user info,
// no path, query or fragment, so a request can only reach the endpoint table under that origin.

export type DotRemoteOriginParse = { ok: true; origin: string } | { ok: false }

const MAX_ORIGIN_CHARS = 2048

export function parseDotRemoteOrigin(input: string): DotRemoteOriginParse {
  const text = input.trim()
  if (text.length === 0 || text.length > MAX_ORIGIN_CHARS || /\s/.test(text)) {
    return { ok: false }
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false }
  }
  const bare =
    url.protocol === 'https:' &&
    url.hostname.length > 0 &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    !text.includes('?') &&
    !text.includes('#')
  return bare ? { ok: true, origin: url.origin } : { ok: false }
}
