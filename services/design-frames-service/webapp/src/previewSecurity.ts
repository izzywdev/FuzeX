/**
 * Browser-side guardrails for immutable UX prototype bundles.
 *
 * Preview bundles must be served by the preview origin, never the FuzeX or
 * FuzeFront application origin. This stops authored HTML from inheriting an
 * authenticated application origin even before the iframe sandbox applies.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' blob:",
].join('; ')

export type PreviewMessage =
  | { type: 'fuzex.preview.ready'; version: 1 }
  | { type: 'fuzex.preview.navigate'; version: 1; path: string }

/**
 * Resolve an entrypoint only if it remains on the dedicated preview origin.
 * A bundle cannot point an iframe at the portal, the API, or another tenant.
 */
export function resolvePreviewUrl(entryUrl: string, previewOrigin: string): string {
  const trustedOrigin = new URL(previewOrigin)
  if (trustedOrigin.protocol !== 'https:') {
    throw new Error('The preview origin must use HTTPS')
  }

  const resolved = new URL(entryUrl, trustedOrigin)
  if (resolved.origin !== trustedOrigin.origin) {
    throw new Error('Preview entrypoint must remain on the dedicated preview origin')
  }
  if (resolved.protocol !== 'https:') {
    throw new Error('Preview entrypoint must use HTTPS')
  }
  return resolved.toString()
}

/** Only accept small, non-sensitive messages emitted by a sandboxed preview. */
export function parsePreviewMessage(value: unknown): PreviewMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (message.version !== 1) return null
  if (message.type === 'fuzex.preview.ready') return { type: message.type, version: 1 }
  if (
    message.type === 'fuzex.preview.navigate' &&
    typeof message.path === 'string' &&
    isSafePreviewPath(message.path)
  ) {
    return { type: message.type, version: 1, path: message.path }
  }
  return null
}

function isSafePreviewPath(path: string): boolean {
  // This is display/navigation metadata only: no URLs, fragments, query
  // strings, traversal, or control characters are accepted from preview JS.
  return path.length > 0 &&
    path.length <= 2048 &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('..') &&
    !/[?#\\\u0000-\u001f]/.test(path)
}
