import React, { useEffect, useState } from 'react'
import { Button, StatusCallout } from '@izzywdev/fuzefront-design-system'
import { createProject, listProjects } from '../api'
import type { Project } from '../types'
import { FeatureList } from './FeatureList'
import { actionsStyle, errorMessage, fieldStyle, gridStyle, panelStyle } from './workspaceStyles'

export function AppList({ token, onSelect, onSelectFeature }: { token: string; onSelect: (id: string) => void; onSelectFeature: (slug: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  async function load(next?: string) {
    setLoading(true); setError('')
    try {
      const result = await listProjects(next)
      setProjects((current) => next ? [...current, ...result.items] : result.items)
      setCursor(result.page.hasMore ? result.page.nextCursor : null)
    } catch (err) { setError(errorMessage(err)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  return <>
    <section aria-labelledby="app-list-heading">
      <h2 id="app-list-heading">Apps</h2>
      <p>Each app has its own UX flows, frame revisions, and design system.</p>
      {error && <StatusCallout tone="error" title="App request failed" actions={<Button variant="secondary" onClick={() => void load()}>Retry</Button>}>{error}</StatusCallout>}
      {loading && <p role="status">Loading apps…</p>}
      {!loading && !error && projects.length === 0 && <p>No apps have been registered yet. Add an app workspace or import a repository with an app association.</p>}
      <div style={gridStyle}>{projects.map((project) => <article key={project.id} style={panelStyle}>
        <h3>{project.name}</h3><p>{project.description}</p><p>{project.sourceRepo}</p>
        <Button onClick={() => onSelect(project.id)}>Open app workspace</Button>
      </article>)}</div>
      {cursor && <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>Load more apps</Button>}
      <div style={actionsStyle}><Button variant="secondary" disabled={busy} onClick={() => setCreating(!creating)}>{creating ? 'Cancel new app' : 'Add app'}</Button></div>
      {creating && <form style={panelStyle} onSubmit={(e) => {
        e.preventDefault(); setBusy(true); setError('')
        createProject(name.trim(), description.trim(), '', token)
          .then((project) => onSelect(project.id)).catch((err) => setError(errorMessage(err))).finally(() => setBusy(false))
      }}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
          <legend>New app workspace</legend>
          <label>App name<input style={fieldStyle} required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Description<textarea style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <p style={{ color: 'var(--text-secondary)' }}>After creating the app, connect one or more repositories from its workspace. Repository ownership is stored in FuzeX, not inferred from an imported manifest.</p>
          <div style={actionsStyle}><Button type="submit">{busy ? 'Creating…' : 'Create app'}</Button></div>
        </fieldset>
      </form>}
    </section>
    <details style={{ marginTop: '24px' }}><summary>Browse all imported UX areas</summary><div style={{ marginTop: '16px' }}><FeatureList onSelect={onSelectFeature} /></div></details>
  </>
}
