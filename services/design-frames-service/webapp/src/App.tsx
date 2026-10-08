import React, { useEffect, useState } from 'react'
import { Eyebrow } from '@izzywdev/fuzefront-design-system'
import { FeatureDetail } from './components/FeatureDetail'
import { AppList } from './components/AppList'
import { AppWorkspace } from './components/AppWorkspace'

/**
 * React port of design-frames-service's vanilla review UI
 * (services/design-frames-service/frontend/{index.html,app.js,styles.css}),
 * built design-system-first on @izzywdev/fuzefront-design-system so it can
 * mount as a Module-Federation portal tile in the FuzeFront host shell
 * instead of an iframe. Uses the hosted project, revision, discussion and
 * generation API (services/design-frames-service/openapi.yaml).
 *
 * Hash routing retains #/<slug> for feature detail and adds #/apps/<id>
 * for app workspaces; no hash displays apps. This works identically whether
 * loaded standalone or mounted inside the host shell (which does not own
 * this remote's internal navigation).
 *
 * This is the module the host loads at runtime — exposed as
 * './DesignFramesApp' (see vite.config.ts).
 */
export default function App() {
  const [route, setRoute] = useState(() => readRouteFromHash())
  // Browser writes use FuzeFront's same-origin delegated proxy. A workload
  // credential is never rendered, stored, or accepted from the browser.
  const token = ''

  useEffect(() => {
    const onHashChange = () => setRoute(readRouteFromHash())
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
        <Eyebrow>FuzeX workspace</Eyebrow>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-3xl)',
            margin: 'var(--space-2) 0 var(--space-1)',
            color: 'var(--text-primary)',
          }}
        >
          Apps, flows & reviews
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            margin: '0 0 var(--space-4)',
            maxWidth: '640px',
          }}
        >
          Imported app frames, revision history, and per-flow review for the
          product-design phase.
        </p>
      </header>

      <main style={{ maxWidth: '1040px', margin: '0 auto' }}>
        {route.type === 'feature' ? (
          <FeatureDetail
            key={route.slug}
            slug={route.slug}
            token={token}
            onBack={() => {
              window.location.hash = ''
            }}
          />
        ) : route.type === 'app' ? (
          <AppWorkspace key={route.id} projectId={route.id} token={token} onBack={() => { window.location.hash = '' }} onSelect={(slug) => { window.location.hash = `/${encodeURIComponent(slug)}` }} />
        ) : (
          <AppList token={token} onSelect={(id) => { window.location.hash = `/apps/${encodeURIComponent(id)}` }} onSelectFeature={(slug) => { window.location.hash = `/${encodeURIComponent(slug)}` }} />
        )}
      </main>
    </div>
  )
}

type Route = { type: 'home' } | { type: 'feature'; slug: string } | { type: 'app'; id: string }

function readRouteFromHash(): Route {
  if (typeof window === 'undefined') return { type: 'home' }
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!hash) return { type: 'home' }
  try {
    if (hash.startsWith('apps/')) return { type: 'app', id: decodeURIComponent(hash.slice(5)) }
    return { type: 'feature', slug: decodeURIComponent(hash) }
  } catch { return { type: 'home' } }
}
