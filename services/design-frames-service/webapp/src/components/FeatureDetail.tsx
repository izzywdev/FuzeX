import React, { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Spinner,
  StatusCallout,
  StatusPill,
  Badge,
  SectionHead,
  EmptyState,
  Alert,
} from '@izzywdev/fuzefront-design-system'
import { getFeature, getStamp, getRevision, listRevisions, siteFrameUrl, approveFlow, rejectFlow } from '../api'
import type { ContentRevision, Manifest, ManifestFrame, RevisionDetail, StampInfo } from '../types'
import { ArrowLeftIcon } from './icons'
import { ApproveFlowModal } from './ApproveFlowModal'
import { RejectFlowModal } from './RejectFlowModal'
import { FrameDiscussionPanel } from './FrameDiscussionPanel'

interface FeatureDetailProps {
  slug: string
  token: string
  onBack: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; manifest: Manifest }

export function FeatureDetail({ slug, token, onBack }: FeatureDetailProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [stamp, setStamp] = useState<StampInfo | null>(null)
  const [selectedFrame, setSelectedFrame] = useState<ManifestFrame | null>(null)
  const [revisions, setRevisions] = useState<ContentRevision[]>([])
  const [revision, setRevision] = useState<RevisionDetail | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(() => {
    setState({ status: 'loading' })
    setActionError(null)
    setRevision(null)
    getFeature(slug)
      .then(({ manifest }) => {
        setState({ status: 'ready', manifest })
        setSelectedFrame(manifest.frames?.[0] ?? null)
      })
      .catch((err) =>
        setState({ status: 'error', message: err?.message || 'Failed to load feature' })
      )
    // Stamp freshness is non-fatal — the vanilla UI swallows this error too.
    getStamp(slug)
      .then(setStamp)
      .catch(() => setStamp(null))
    listRevisions(slug)
      .then(({ revisions }) => setRevisions(revisions))
      .catch(() => setRevisions([]))
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

  const flows = state.status === 'ready' ? state.manifest.build?.flows ?? [] : []
  const reviewManifest = revision?.manifest ?? (state.status === 'ready' ? state.manifest : null)

  async function selectRevision(value: string) {
    setActionError(null)
    if (!value) {
      setRevision(null)
      if (state.status === 'ready') setSelectedFrame(state.manifest.frames?.[0] ?? null)
      return
    }
    try {
      const selected = await getRevision(slug, value)
      setRevision(selected)
      setSelectedFrame(selected.manifest.frames?.[0] ?? null)
    } catch (err: any) {
      setActionError(err?.message || 'Failed to load revision')
    }
  }

  async function handleApprove(approvedBy: string) {
    if (!approveTarget) return
    setSubmitting(true)
    setActionError(null)
    try {
      await approveFlow(slug, approveTarget, approvedBy, token)
      setApproveTarget(null)
      load()
    } catch (err: any) {
      setActionError(err?.message || 'Approve failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject(reason: string | undefined) {
    if (!rejectTarget) return
    setSubmitting(true)
    setActionError(null)
    try {
      await rejectFlow(slug, rejectTarget, reason, token)
      setRejectTarget(null)
      load()
    } catch (err: any) {
      setActionError(err?.message || 'Revoke failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-label={state.status === 'ready' ? state.manifest.name : 'Feature detail'}>
      <Button variant="ghost" size="sm" leadingIcon={<ArrowLeftIcon />} onClick={onBack}>
        Back to features
      </Button>

      {state.status === 'loading' && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
          <Spinner label="Loading feature" />
        </div>
      )}

      {state.status === 'error' && (
        <StatusCallout
          tone="error"
          title="Failed to load feature"
          actions={
            <Button variant="secondary" size="sm" onClick={load}>
              Retry
            </Button>
          }
        >
          {state.message}
        </StatusCallout>
      )}

      {state.status === 'ready' && (
        <>
          <div style={{ margin: 'var(--space-4) 0 var(--space-6)' }}>
            <SectionHead title={state.manifest.name} description={state.manifest.description} />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                marginTop: 'var(--space-3)',
              }}
            >
              <Badge mono tone="neutral">
                {state.manifest.stamp ? `${state.manifest.stamp.slice(0, 12)}…` : '(unstamped)'}
              </Badge>
              {stamp && (
                <StatusPill
                  status={stamp.current ? 'verified' : 'pending'}
                  label={stamp.current ? 'Up to date' : 'Stale — recompute'}
                />
              )}
              {revisions.length > 0 && (
                <label style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                  Revision{' '}
                  <select
                    aria-label="Select frame revision"
                    value={revision?.stamp ?? ''}
                    onChange={(event) => void selectRevision(event.target.value)}
                  >
                    <option value="">Current working copy</option>
                    {revisions.map((item) => (
                      <option key={item.stamp} value={item.stamp}>
                        {new Date(item.createdAt).toLocaleString()} · {item.stamp.slice(0, 12)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          {actionError && (
            <Alert tone="error" onDismiss={() => setActionError(null)} style={{ marginBottom: 'var(--space-4)' }}>
              {actionError}
            </Alert>
          )}

          {reviewManifest?.frames && reviewManifest.frames.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '220px 1fr',
                gap: 'var(--space-6)',
                marginBottom: 'var(--space-8)',
              }}
            >
              <nav
                aria-label="Frames"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
              >
                {reviewManifest.frames.map((frame) => (
                  <Button
                    key={frame.id}
                    variant={selectedFrame?.id === frame.id ? 'primary' : 'secondary'}
                    size="sm"
                    aria-current={selectedFrame?.id === frame.id}
                    onClick={() => setSelectedFrame(frame)}
                    style={{ justifyContent: 'flex-start', width: '100%' }}
                  >
                    {frame.label}
                  </Button>
                ))}
              </nav>
              <div>
                {selectedFrame ? (
                  <iframe
                    sandbox=""
                    title={`Frame preview: ${selectedFrame.label}`}
                    src={revision ? undefined : siteFrameUrl(slug, selectedFrame.file)}
                    srcDoc={revision ? revision.frames[selectedFrame.file] : undefined}
                    style={{
                      width: '100%',
                      height: '70vh',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-lg)',
                      background: 'var(--bg-primary, #fff)',
                    }}
                  />
                ) : (
                  <EmptyState compact title="Select a frame to preview" />
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No frames yet"
              body="This feature's manifest has no frames declared."
              style={{ marginBottom: 'var(--space-8)' }}
            />
          )}

          {revision && selectedFrame && (
            <FrameDiscussionPanel slug={slug} stamp={revision.stamp} frame={selectedFrame} frameHtml={revision.frames[selectedFrame.file]} token={token} />
          )}

          {!revision && <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-xl)',
              color: 'var(--text-primary)',
              margin: '0 0 var(--space-3)',
            }}
          >
            Flows
          </h3>}
          {!revision && (flows.length === 0 ? (
            <EmptyState compact title="No flows declared." />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {flows.map((flow) => (
                <li
                  key={flow.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) 0',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{flow.id}</strong>{' '}
                    <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                      {flow.orchestrator} → {flow.route}
                    </span>
                  </div>
                  <StatusPill status={flow.approved ? 'active' : 'pending'} />
                  {flow.approved ? (
                    <Button variant="danger" size="sm" onClick={() => setRejectTarget(flow.id)}>
                      Revoke
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => setApproveTarget(flow.id)}>
                      Approve
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ))}
        </>
      )}

      <ApproveFlowModal
        open={approveTarget !== null}
        flowId={approveTarget}
        submitting={submitting}
        onCancel={() => setApproveTarget(null)}
        onConfirm={handleApprove}
      />
      <RejectFlowModal
        open={rejectTarget !== null}
        flowId={rejectTarget}
        submitting={submitting}
        onCancel={() => setRejectTarget(null)}
        onConfirm={handleReject}
      />
    </section>
  )
}
