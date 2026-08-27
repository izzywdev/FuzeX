import React, { useCallback, useEffect, useState } from 'react'
import {
  DataTable,
  EmptyState,
  StatusCallout,
  Button,
  Badge,
} from '@izzywdev/fuzefront-design-system'
import { listFeatures } from '../api'
import type { FeatureSummary } from '../types'
import { RetryIcon } from './icons'

const COLUMNS = [
  { key: 'name', header: 'Feature' },
  { key: 'frames', header: 'Frames', align: 'center' as const },
  { key: 'flows', header: 'Flows approved', align: 'center' as const },
  { key: 'sourceRepo', header: 'For' },
]

interface FeatureListProps {
  onSelect: (slug: string) => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; features: FeatureSummary[] }

export function FeatureList({ onSelect }: FeatureListProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const load = useCallback(() => {
    setState({ status: 'loading' })
    listFeatures()
      .then(({ features }) => setState({ status: 'ready', features }))
      .catch((err) =>
        setState({ status: 'error', message: err?.message || 'Failed to load features' })
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section aria-labelledby="feature-list-heading">
      <h2
        id="feature-list-heading"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-2xl)',
          color: 'var(--text-primary)',
          margin: '0 0 var(--space-4)',
        }}
      >
        Features
      </h2>

      {state.status === 'error' && (
        <StatusCallout
          tone="error"
          title="Failed to load features"
          actions={
            <Button variant="secondary" size="sm" leadingIcon={<RetryIcon />} onClick={load}>
              Retry
            </Button>
          }
        >
          {state.message}
        </StatusCallout>
      )}

      {state.status !== 'error' && (
        <DataTable
          columns={COLUMNS}
          loading={state.status === 'loading'}
          emptyState={
            <EmptyState
              compact
              title="No features yet"
              body="Once product-designer authors frames for a feature, they'll show up here."
            />
          }
        >
          {state.status === 'ready' && state.features.length > 0 && (
            <tbody>
              {state.features.map((f) => {
                const approvedCount = f.flows.filter((fl) => fl.approved).length
                return (
                  <tr
                    key={f.slug}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open feature ${f.name}`}
                    onClick={() => onSelect(f.slug)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(f.slug)
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={cellStyle}>
                      <div
                        style={{
                          fontWeight: 'var(--weight-semibold)',
                          color: 'var(--accent-color)',
                        }}
                      >
                        {f.name}
                      </div>
                      {f.description && (
                        <div
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--text-secondary)',
                            marginTop: 'var(--space-1)',
                          }}
                        >
                          {f.description}
                        </div>
                      )}
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>{f.frameCount}</td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      <Badge tone={approvedCount === f.flows.length && f.flows.length > 0 ? 'success' : 'neutral'}>
                        {approvedCount}/{f.flows.length}
                      </Badge>
                    </td>
                    <td style={cellStyle}>{f.sourceRepo || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          )}
        </DataTable>
      )}
    </section>
  )
}

const cellStyle: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
}
