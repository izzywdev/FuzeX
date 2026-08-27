import React, { useEffect, useState } from 'react'
import { Input, Eyebrow } from '@izzywdev/fuzefront-design-system'
import { FeatureList } from './components/FeatureList'
import { FeatureDetail } from './components/FeatureDetail'

/**
 * React port of design-frames-service's vanilla review UI
 * (services/design-frames-service/frontend/{index.html,app.js,styles.css}),
 * built design-system-first on @izzywdev/fuzefront-design-system so it can
 * mount as a Module-Federation portal tile in the FuzeFront host shell
 * instead of an iframe. Talks to the SAME REST API the vanilla page used
 * (services/design-frames-service/openapi.yaml) — no shape changes.
 *
 * Routing mirrors the vanilla page's hash-based nav (#/<slug> = feature
 * detail, no hash = feature list) so this remote works identically whether
 * loaded standalone or mounted inside the host shell (which does not own
 * this remote's internal navigation).
 *
 * This is the module the host loads at runtime — exposed as
 * './DesignFramesApp' (see vite.config.ts).
 */
export default function App() {
  const [slug, setSlug] = useState<string | null>(() => readSlugFromHash())
  const [token, setToken] = useState('')

  useEffect(() => {
    const onHashChange = () => setSlug(readSlugFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div
      style={{
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-primary)',
        background: 'var(--bg-primary, var(--graphite-900, #0f131c))',
        minHeight: '100%',
        padding: 'var(--space-6)',
      }}
    >
      <header style={{ maxWidth: '1040px', margin: '0 auto var(--space-6)' }}>
        <Eyebrow>Design Frames</Eyebrow>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-3xl)',
            margin: 'var(--space-2) 0 var(--space-1)',
            color: 'var(--text-primary)',
          }}
        >
          Design Frames Review
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            margin: '0 0 var(--space-4)',
            maxWidth: '640px',
          }}
        >
          Navigable frames, contract, and per-flow approval for the
          product-design phase — served by FuzeX's design-frames-service.
        </p>
        <div style={{ maxWidth: '360px' }}>
          <Input
            label="API token (writes only)"
            type="password"
            placeholder="paste a DESIGN_FRAMES_API_TOKENS value"
            autoComplete="off"
            value={token}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
          />
        </div>
      </header>

      <main style={{ maxWidth: '1040px', margin: '0 auto' }}>
        {slug ? (
          <FeatureDetail
            slug={slug}
            token={token}
            onBack={() => {
              window.location.hash = ''
            }}
          />
        ) : (
          <FeatureList onSelect={(s) => (window.location.hash = `/${encodeURIComponent(s)}`)} />
        )}
      </main>
    </div>
  )
}

function readSlugFromHash(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#\//, '')
  return hash ? decodeURIComponent(hash) : null
}
