import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Alert, Button, EmptyState, Input, Spinner, StatusPill, Textarea } from '@izzywdev/fuzefront-design-system'
import { addDiscussionComment, createElementDiscussion, getDiscussion, listElementDiscussions, listRevisionFrameRefs, setDiscussionResolved } from '../api'
import type { Discussion, DiscussionComment, DiscussionDetail, ManifestFrame } from '../types'
import { TraceabilityPanel } from './TraceabilityPanel'

interface FrameDiscussionPanelProps {
  slug: string
  stamp: string
  frame: ManifestFrame
  frameHtml?: string
  token: string
  projectId: string | null
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function CommentTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>
}

// Remounting on frame identity prevents drafts and delayed responses from one
// immutable revision being shown (or submitted) against another revision.
export function FrameDiscussionPanel(props: FrameDiscussionPanelProps) {
  return <FrameAnnotations key={`${props.slug}:${props.stamp}:${props.frame.file}`} {...props} />
}

function FrameAnnotations({ slug, stamp, frame, frameHtml, token, projectId }: FrameDiscussionPanelProps) {
  const [discussions, setDiscussions] = useState<Discussion[]>([])
  const [selector, setSelector] = useState('body')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [frameRef, setFrameRef] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const mounted = useRef(false)
  const headingId = useId()
  const detailId = useId()
  const canWrite = Boolean(token.trim())
  const targets = useMemo(() => {
    if (!frameHtml || typeof DOMParser === 'undefined') return []
    // Parsing an inert document never executes imported scripts. Only stable
    // anchors are copied out; imported markup is never inserted into this UI.
    const document = new DOMParser().parseFromString(frameHtml, 'text/html')
    const anchors = new Map<string, string>()
    document.querySelectorAll('[data-testid], [data-testhook]').forEach((element) => {
      for (const attribute of ['data-testid', 'data-testhook']) {
        const value = element.getAttribute(attribute)
        // Keep selectors within the API's supported stable-anchor syntax.
        if (!value || !/^[a-zA-Z0-9_.:-]+$/.test(value)) continue
        const selector = `[${attribute}=${value}]`
        const label = element.getAttribute('aria-label') || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || value
        anchors.set(selector, `${label} (${value})`)
      }
    })
    return Array.from(anchors, ([value, label]) => ({ value, label }))
  }, [frameHtml])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { frames } = await listRevisionFrameRefs(slug, stamp)
      const match = frames.find((item) => item.file === frame.file)
      if (!mounted.current) return
      if (!match) throw new Error('Annotations are not available for this frame revision yet.')
      const result = await listElementDiscussions(match.id)
      if (!mounted.current) return
      setFrameRef(match.id)
      setDiscussions(result.items)
      setNextCursor(result.page.hasMore ? result.page.nextCursor : null)
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, 'Failed to load annotations'))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [frame.file, slug, stamp])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  async function loadMore() {
    if (!frameRef || !nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const result = await listElementDiscussions(frameRef, nextCursor)
      if (!mounted.current) return
      setDiscussions((items) => {
        const ids = new Set(items.map((item) => item.id))
        return [...items, ...result.items.filter((item) => !ids.has(item.id))]
      })
      setNextCursor(result.page.hasMore ? result.page.nextCursor : null)
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, 'Failed to load more annotations'))
    } finally {
      if (mounted.current) setLoadingMore(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canWrite || !frameRef || !selector.trim() || !feedback.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    setNotice('')
    try {
      const discussion = await createElementDiscussion(frameRef, selector.trim(), feedback.trim(), token)
      if (!mounted.current) return
      setFeedback('')
      setDiscussions((items) => [discussion, ...items])
      setFilter('all')
      setSelectedId(discussion.id)
      setNotice('Annotation added to this frame revision.')
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, 'Failed to create annotation'))
    } finally {
      if (mounted.current) setSubmitting(false)
    }
  }

  const visible = discussions.filter((item) => filter === 'all' || item.resolved === (filter === 'resolved'))
  const selected = discussions.find((item) => item.id === selectedId)

  return (
    <section aria-labelledby={headingId} style={{ marginTop: 'var(--space-6)' }}>
      <h3 id={headingId} style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)' }}>
        Frame annotations
      </h3>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
        {frame.label} · Revision <code>{stamp.slice(0, 12)}</code>
      </p>
      <p role="status" aria-live="polite" style={{ color: 'var(--text-secondary)' }}>{notice}</p>
      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {loading ? <Spinner label="Loading frame annotations" /> : (
        <>
          {!frameRef ? (
            <Button variant="secondary" onClick={() => void load()}>Retry annotations</Button>
          ) : (
            <>
              {!canWrite && <p>Sign in or provide a reviewer token to add feedback or change annotation status.</p>}
              <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-3)', margin: 'var(--space-4) 0' }}>
                {frameHtml ? (
                  <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
                    Annotation target
                    <select value={selector} onChange={(event) => setSelector(event.target.value)} disabled={submitting || !canWrite}>
                      <option value="body">Whole frame</option>
                      {targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <Input
                    label="Annotation target"
                    value={selector}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSelector(event.target.value)}
                    placeholder="body or [data-testid=save-button]"
                    disabled={submitting || !canWrite}
                  />
                )}
                <Textarea
                  label="Feedback"
                  value={feedback}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setFeedback(event.target.value)}
                  placeholder="Describe the requested change or question"
                  rows={3}
                  disabled={submitting || !canWrite}
                />
                <div>
                  <Button type="submit" variant="primary" disabled={submitting || !canWrite || !selector.trim() || !feedback.trim()}>
                    {submitting ? 'Saving…' : 'Add annotation'}
                  </Button>
                </div>
              </form>
              <label style={{ color: 'var(--text-secondary)' }}>
                Show annotations{' '}
                <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
              {visible.length === 0 ? (
                <EmptyState compact title={discussions.length === 0 ? 'No annotations on this frame revision' : 'No matching annotations'} />
              ) : (
                <ul style={{ listStyle: 'none', margin: 'var(--space-3) 0', padding: 0 }}>
                  {visible.map((discussion) => (
                    <li key={discussion.id} style={{ borderTop: '1px solid var(--border-color)', padding: 'var(--space-3) 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <Button
                          variant={selectedId === discussion.id ? 'primary' : 'secondary'}
                          aria-expanded={selectedId === discussion.id}
                          aria-controls={selectedId === discussion.id ? detailId : undefined}
                          onClick={() => setSelectedId(selectedId === discussion.id ? null : discussion.id)}
                          style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left' }}
                        >
                          {discussion.title || 'Untitled annotation'}
                        </Button>
                        <StatusPill status={discussion.resolved ? 'active' : 'pending'} label={discussion.resolved ? 'Resolved' : 'Open'} />
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                        <code>{discussion.targetSelector === 'body' ? 'Whole frame' : discussion.targetSelector}</code>
                        {' · '}<CommentTime value={discussion.createdAt} />
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {nextCursor && <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more annotations'}
              </Button>}
              {selected && <DiscussionThread
                key={selected.id}
                regionId={detailId}
                discussion={selected}
                token={token}
                onUpdate={(updated) => setDiscussions((items) => items.map((item) => item.id === updated.id ? updated : item))}
              />}
              {projectId && frameRef && <TraceabilityPanel projectId={projectId} token={token} compact target={{ targetType: 'element', targetRef: frameRef, selector, contentStamp: stamp }} />}
            </>
          )}
        </>
      )}
    </section>
  )
}

function DiscussionThread({ discussion, token, onUpdate, regionId }: {
  discussion: Discussion
  token: string
  onUpdate: (updated: Discussion) => void
  regionId: string
}) {
  const [detail, setDetail] = useState<DiscussionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [reply, setReply] = useState('')
  const [replyTo, setReplyTo] = useState<DiscussionComment | null>(null)
  const mounted = useRef(false)
  const canWrite = Boolean(token.trim())
  const replyInputId = useId()
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getDiscussion(discussion.id)
      if (mounted.current) {
        setDetail(result)
        onUpdateRef.current(result)
      }
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, 'Failed to load annotation thread'))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [discussion.id])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  async function resolve() {
    if (!canWrite || busy) return
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const updated = await setDiscussionResolved(discussion.id, !discussion.resolved, token)
      if (!mounted.current) return
      onUpdate(updated)
      setNotice(updated.resolved ? 'Annotation resolved.' : 'Annotation reopened.')
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, 'Failed to update annotation'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function submitReply(event: React.FormEvent) {
    event.preventDefault()
    if (!canWrite || busy || !reply.trim()) return
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const comment = await addDiscussionComment(discussion.id, reply.trim(), token, replyTo?.id)
      if (!mounted.current) return
      setDetail((current) => current ? { ...current, comments: [...current.comments, comment] } : current)
      setReply('')
      setReplyTo(null)
      setNotice('Reply added.')
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, 'Failed to add reply'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <section id={regionId} aria-label={`Annotation thread: ${discussion.title || 'Untitled annotation'}`} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
      <h4 style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{discussion.title || 'Untitled annotation'}</h4>
      <Button variant="secondary" size="sm" onClick={() => void resolve()} disabled={busy || !canWrite}>
        {busy ? 'Saving…' : discussion.resolved ? 'Reopen annotation' : 'Resolve annotation'}
      </Button>
      <p role="status" aria-live="polite">{notice}</p>
      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {loading ? <Spinner label="Loading annotation thread" /> : !detail ? (
        <Button variant="secondary" onClick={() => void load()}>Retry thread</Button>
      ) : (
        <>
          {detail.comments.length === 0 ? <p>No replies yet.</p> : (
            <ol style={{ listStyle: 'none', padding: 0 }}>
              {detail.comments.map((comment) => {
                const parent = detail.comments.find((item) => item.id === comment.parentCommentId)
                return <li key={comment.id} style={{ borderTop: '1px solid var(--border-color)', padding: 'var(--space-3) 0' }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                    {comment.authorType === 'agent' ? 'Agent' : 'Reviewer'}{' · '}<CommentTime value={comment.createdAt} />
                  </p>
                  {parent && <blockquote style={{ margin: 'var(--space-2) 0', paddingLeft: 'var(--space-3)', borderLeft: '2px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    Replying to: {parent.deleted ? 'Deleted comment' : parent.body.slice(0, 160)}
                  </blockquote>}
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.deleted ? 'This comment was deleted.' : comment.body}</p>
                  {!comment.deleted && <Button variant="ghost" size="sm" disabled={busy || !canWrite} onClick={() => { setReplyTo(comment); document.getElementById(replyInputId)?.focus() }}>Reply to comment</Button>}
                </li>
              })}
            </ol>
          )}
          <form onSubmit={submitReply} style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {replyTo && <div style={{ overflowWrap: 'anywhere' }}>
              Replying to: {replyTo.body.slice(0, 160)}{' '}
              <Button type="button" variant="ghost" size="sm" onClick={() => setReplyTo(null)} disabled={busy}>Cancel reply target</Button>
            </div>}
            <Textarea id={replyInputId} label="Reply" value={reply} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReply(event.target.value)} rows={3} disabled={busy || !canWrite} />
            <div><Button type="submit" variant="primary" disabled={busy || !canWrite || !reply.trim()}>{busy ? 'Saving…' : 'Add reply'}</Button></div>
          </form>
        </>
      )}
    </section>
  )
}
