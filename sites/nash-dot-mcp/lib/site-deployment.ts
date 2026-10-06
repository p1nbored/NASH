// Registered owner-private Site. This origin is public metadata, never a credential.
// Hosted service access is validated and consumed by Sites dispatch before the Worker.
// Keep this Site owner-private; widening its audience requires a new admission design.
export const SITE_ORIGIN = 'https://nash-dot-mcp.taojuguo.chatgpt.site';

export function hostedPrivateSite(request: Request): boolean {
  return process.env.NODE_ENV === 'production' && new URL(request.url).origin === SITE_ORIGIN;
}
