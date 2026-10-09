import React, { useEffect, useMemo, useRef } from 'react'
import { PREVIEW_CSP, parsePreviewMessage, resolvePreviewUrl, type PreviewMessage } from '../previewSecurity'

export interface UXBundlePreviewProps {
  /** The immutable bundle entrypoint, relative to or on previewOrigin. */
  entryUrl: string
  /** Dedicated, cookie-free HTTPS origin used exclusively for UX bundles. */
  previewOrigin: string
  title: string
  /** Receives only schema-validated, non-sensitive preview lifecycle messages. */
  onPreviewMessage?: (message: PreviewMessage) => void
  style?: React.CSSProperties
}

// lib.dom has not caught up with the standardized iframe `csp` attribute.
// React still emits this lowercase attribute during the initial element create,
// before the remote document has a chance to load.
const iframeCspAttribute = { csp: PREVIEW_CSP } as unknown as React.IframeHTMLAttributes<HTMLIFrameElement>

/**
 * Renders an interactive UX prototype, not a live application.
 *
 * The bundle gets scripts so static prototypes can navigate locally, but it
 * never gets same-origin privileges, storage, forms, network access, browser
 * permissions, or a FuzeX/FuzeFront session. The preview server must also set
 * PREVIEW_CSP as a response header; the iframe CSP is a second browser guard.
 */
export function UXBundlePreview({
  entryUrl,
  previewOrigin,
  title,
  onPreviewMessage,
  style,
}: UXBundlePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const src = useMemo(() => resolvePreviewUrl(entryUrl, previewOrigin), [entryUrl, previewOrigin])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      // A sandbox without allow-same-origin intentionally reports origin as
      // "null". The exact iframe WindowProxy is the trustworthy boundary.
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = parsePreviewMessage(event.data)
      if (message) onPreviewMessage?.(message)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onPreviewMessage])

  return (
    <iframe
      ref={iframeRef}
      title={title}
      src={src}
      sandbox="allow-scripts"
      {...iframeCspAttribute}
      referrerPolicy="no-referrer"
      allow=""
      style={{
        width: '100%',
        height: '70vh',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-primary, #fff)',
        ...style,
      }}
    />
  )
}
