import React, { useEffect, useState } from 'react'
import { Button, StatusCallout } from '@izzywdev/fuzefront-design-system'
import { ApiError, createDesignSystemRevision, listDesignSystemRevisions } from '../api'
import type { DesignSystemComponent, DesignSystemRevision } from '../types'
import { actionsStyle, errorMessage, fieldStyle, gridStyle, panelStyle } from './workspaceStyles'

export function DesignSystemPanel({ projectId, latest, token, onChanged }: { projectId: string; latest: DesignSystemRevision | null; token: string; onChanged: (revision: DesignSystemRevision) => void }) {
  const [history, setHistory] = useState<DesignSystemRevision[]>([])
  const [selected, setSelected] = useState<DesignSystemRevision | null>(latest)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(latest?.name || '')
  const [description, setDescription] = useState(latest?.description || '')
  const [tokens, setTokens] = useState(JSON.stringify(latest?.tokens || {}, null, 2))
  const [components, setComponents] = useState<DesignSystemComponent[]>(latest?.components || [])
  const [reasons, setReasons] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setSelected(latest)
    void (async () => {
      const revisions: DesignSystemRevision[] = []
      let cursor: string | undefined
      do {
        const result = await listDesignSystemRevisions(projectId, cursor)
        revisions.push(...result.items)
        cursor = result.page.hasMore ? result.page.nextCursor || undefined : undefined
      } while (cursor && active)
      if (active) setHistory(revisions)
    })().catch((err) => { if (active) setError(errorMessage(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, latest])

  function beginEdit() {
    setName(latest?.name || ''); setDescription(latest?.description || '')
    setTokens(JSON.stringify(latest?.tokens || {}, null, 2)); setComponents((latest?.components || []).map((component) => ({ ...component })))
    setEditing(true); setError('')
  }

  function editComponent(index: number, patch: Partial<DesignSystemComponent>) {
    setComponents((current) => current.map((component, i) => {
      if (i !== index) return component
      const { reason: _previousReason, ...rest } = component
      return { ...rest, ...patch, status: 'draft' }
    }))
  }

  async function save(nextComponents?: DesignSystemComponent[]) {
    setBusy(true); setError('')
    try {
      const parsedTokens: unknown = nextComponents ? latest!.tokens : JSON.parse(tokens)
      const parsedComponents = nextComponents || components
      if (!parsedTokens || typeof parsedTokens !== 'object' || Array.isArray(parsedTokens)) throw new Error('Tokens must be a JSON object.')
      if (!Array.isArray(parsedComponents)) throw new Error('Components must be a JSON array.')
      const revision = await createDesignSystemRevision(projectId, {
        expectedRevision: latest?.revision || 0,
        name: nextComponents ? latest!.name : name.trim(),
        description: nextComponents ? latest!.description : description.trim() || null,
        tokens: parsedTokens as Record<string, unknown>, components: parsedComponents as DesignSystemComponent[],
      }, token)
      setSelected(revision); setEditing(false); onChanged(revision)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409
        ? `${err.message}. Refresh the app workspace to review the latest revision before saving your changes.` : errorMessage(err))
    } finally { setBusy(false) }
  }

  function review(component: DesignSystemComponent, status: 'approved' | 'rejected' | 'draft') {
    if (!latest) return
    const reason = reasons[component.key]?.trim()
    if (status === 'rejected' && !reason) { setError('Enter a rejection reason for this component.'); return }
    void save(latest.components.map((item) => {
      if (item.key !== component.key) return item
      const { reason: _previousReason, ...rest } = item
      return { ...rest, status, ...(status === 'rejected' ? { reason } : {}) }
    }))
  }

  return <section aria-labelledby="design-system-heading" style={panelStyle}>
    <h3 id="design-system-heading">Design system & components</h3>
    {error && <StatusCallout tone="error" title="Design system request failed">{error}</StatusCallout>}
    {loading && <p role="status">Loading design system revisions…</p>}
    {!latest && <p>No design system has been registered for this app. Create its first revision to inventory tokens and components.</p>}
    {history.length > 0 && <label>Design system revision<select style={fieldStyle} value={selected?.revision || ''} onChange={(e) => setSelected(history.find((revision) => revision.revision === Number(e.target.value)) || latest)}>
      {[...history].reverse().map((revision) => <option key={revision.revision} value={revision.revision}>Revision {revision.revision} · {new Date(revision.createdAt).toLocaleString()}{revision.revision === latest?.revision ? ' · Current' : ''}</option>)}
    </select></label>}
    {selected && <>
      <h4>{selected.name}</h4><p>{selected.description}</p>
      {selected.revision !== latest?.revision && <p role="status">Viewing an earlier revision. Component decisions can be made on the current revision.</p>}
      <p>{selected.components.length} components · Revision {selected.revision}</p>
      <div style={gridStyle}>{selected.components.map((component) => <article key={component.key} style={panelStyle}>
        <h4>{component.name} · {component.status || 'draft'}</h4>
        <code>{component.key}</code><p>{component.description}</p>
        {component.usage && <p>Usage: {component.usage}</p>}
        {component.selector && <p>Selector: <code>{component.selector}</code></p>}
        {component.reason && <p>Rejection reason: {component.reason}</p>}
        {selected.revision === latest?.revision && <>
          <label>Rejection reason for {component.name}<input style={fieldStyle} value={reasons[component.key] || ''} onChange={(e) => setReasons({ ...reasons, [component.key]: e.target.value })} /></label>
          <div style={actionsStyle}>
            <Button size="sm" disabled={busy || !token.trim() || component.status === 'approved'} onClick={() => review(component, 'approved')}>Approve</Button>
            <Button size="sm" variant="secondary" disabled={busy || !token.trim() || !reasons[component.key]?.trim()} onClick={() => review(component, 'rejected')}>Reject</Button>
            {component.status && component.status !== 'draft' && <Button size="sm" variant="secondary" disabled={busy || !token.trim()} onClick={() => review(component, 'draft')}>Return to draft</Button>}
          </div>
        </>}
      </article>)}</div>
      {selected.components.length === 0 && <p>No components in this revision.</p>}
      <details><summary>Design tokens</summary><pre style={{ overflowX: 'auto' }}>{JSON.stringify(selected.tokens, null, 2)}</pre></details>
    </>}
    <div style={actionsStyle}><Button variant="secondary" disabled={busy || !token.trim()} onClick={beginEdit}>{latest ? 'Create a design system revision' : 'Add design system'}</Button></div>
    {!token.trim() && <p>Sign in with write access to edit the design system or review components.</p>}
    {editing && <form onSubmit={(e) => { e.preventDefault(); void save() }} style={{ marginTop: '16px' }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <legend>New revision based on {latest ? `revision ${latest.revision}` : 'an empty design system'}</legend>
        <label>Name<input style={fieldStyle} required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Description<textarea style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <details><summary>Edit design tokens</summary><label>Tokens (JSON object)<textarea style={fieldStyle} rows={7} value={tokens} onChange={(e) => setTokens(e.target.value)} /></label></details>
        <h4>Component inventory</h4>
        {components.map((component, index) => <fieldset key={index} style={panelStyle}>
          <legend>Component {index + 1}</legend>
          <div style={gridStyle}>
            <label>Stable component key<input style={fieldStyle} required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*" value={component.key} onChange={(e) => editComponent(index, { key: e.target.value })} /></label>
            <label>Component name<input style={fieldStyle} required value={component.name} onChange={(e) => editComponent(index, { name: e.target.value })} /></label>
          </div>
          <label>Description<textarea style={fieldStyle} value={component.description || ''} onChange={(e) => editComponent(index, { description: e.target.value })} /></label>
          <label>Usage guidance<textarea style={fieldStyle} value={component.usage || ''} onChange={(e) => editComponent(index, { usage: e.target.value })} /></label>
          <label>Frame selector (optional)<input style={fieldStyle} value={component.selector || ''} onChange={(e) => editComponent(index, { selector: e.target.value })} /></label>
          <Button type="button" variant="secondary" onClick={() => setComponents(components.filter((_, i) => i !== index))}>Remove component {index + 1}</Button>
        </fieldset>)}
        <Button type="button" variant="secondary" onClick={() => setComponents([...components, { key: '', name: '', status: 'draft' }])}>Add component</Button>
        <div style={actionsStyle}><Button type="submit">Save new revision</Button><Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
      </fieldset>
    </form>}
  </section>
}
