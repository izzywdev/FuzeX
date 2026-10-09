import React, { useCallback, useEffect, useState } from 'react'
import { Button, StatusCallout } from '@izzywdev/fuzefront-design-system'
import { connectProjectRepository, getProjectWorkspace, listProjectFeatures } from '../api'
import type { FeatureSummary, ProjectWorkspace } from '../types'
import { DesignSystemPanel } from './DesignSystemPanel'
import { FlowGenerationPanel } from './FlowGenerationPanel'
import { TraceabilityPanel } from './TraceabilityPanel'
import { actionsStyle, errorMessage, gridStyle, panelStyle } from './workspaceStyles'

export function AppWorkspace({ projectId, token, onBack, onSelect }: { projectId: string; token: string; onBack: () => void; onSelect: (slug: string) => void }) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null)
  const [features, setFeatures] = useState<FeatureSummary[]>([])
  const [selectedSlug, setSelectedSlug] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [repository, setRepository] = useState('')
  const [framesPath, setFramesPath] = useState('design/frames')
  const [connecting, setConnecting] = useState(false)
  const reload = useCallback(() => setRefresh((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void (async () => {
      const [summary, areas] = await Promise.all([getProjectWorkspace(projectId), (async () => {
        const all: FeatureSummary[] = []
        let cursor: string | undefined
        do {
          const page = await listProjectFeatures(projectId, cursor)
          all.push(...page.items); cursor = page.page.hasMore ? page.page.nextCursor || undefined : undefined
        } while (cursor && active)
        return all
      })()])
      if (!active) return
      setWorkspace(summary); setFeatures(areas)
      setSelectedSlug((current) => areas.some((area) => area.slug === current) ? current : areas[0]?.slug || '')
    })().catch((err) => { if (active) setError(errorMessage(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, refresh])

  return <section aria-labelledby="app-workspace-heading">
    <div style={actionsStyle}><Button variant="secondary" onClick={onBack}>All apps</Button><Button variant="secondary" onClick={reload}>Refresh workspace</Button></div>
    {loading && <p role="status">Loading app workspace…</p>}
    {error && <StatusCallout tone="error" title="Cannot load app workspace">{error}</StatusCallout>}
    {workspace && <>
      <h2 id="app-workspace-heading">{workspace.project.name}</h2>
      <p>{workspace.project.description}</p>
      <p>{workspace.featureCount} UX areas · {workspace.flowCount} flows · {workspace.frameCount} frames</p>
      <section style={panelStyle} aria-labelledby="connected-repositories-heading">
        <h3 id="connected-repositories-heading">Connected repositories</h3>
        {workspace.repositories.length === 0 && <p>Connect a repository to adopt matching imported frames and make future imports appear in this app.</p>}
        {workspace.repositories.length > 0 && <ul>{workspace.repositories.map((item) => <li key={item.repository}><code>{item.repository}</code> · {item.framesPath}</li>)}</ul>}
        <form onSubmit={(event) => {
          event.preventDefault(); setConnecting(true); setError('')
          connectProjectRepository(projectId, repository.trim(), framesPath.trim(), token)
            .then(() => { setRepository(''); reload() })
            .catch((err) => setError(errorMessage(err))).finally(() => setConnecting(false))
        }}>
          <label>Repository<input required placeholder="izzywdev/FuzeFront" value={repository} onChange={(event) => setRepository(event.target.value)} style={{ margin: '8px', padding: '8px' }} /></label>
          <label>Frames path<input required value={framesPath} onChange={(event) => setFramesPath(event.target.value)} style={{ margin: '8px', padding: '8px' }} /></label>
          <Button type="submit" disabled={connecting}>{connecting ? 'Connecting…' : 'Connect repository'}</Button>
        </form>
      </section>
      <section style={panelStyle} aria-labelledby="detected-services-heading">
        <h3 id="detected-services-heading">Detected services</h3>
        {workspace.detectedServices.length === 0 ? <p>Services are detected from imported flow contracts after a connected repository publishes its frames.</p> : <ul>{workspace.detectedServices.map((service) => <li key={service.openapi}><code>{service.name}</code> · {service.featureCount} UX area{service.featureCount === 1 ? '' : 's'}</li>)}</ul>}
      </section>
      <h3>UX areas & flows</h3>
      {features.length === 0 && <p>No UX areas are linked to this app yet. Import frames into this workspace to begin review and generation.</p>}
      <div style={gridStyle}>{features.map((feature) => <article key={feature.slug} style={panelStyle}>
        <h4>{feature.name}</h4><p>{feature.description}</p>
        <p>{feature.frameCount} frames · {feature.flows.filter((flow) => flow.approved).length}/{feature.flows.length} flows approved</p>
        {feature.flows.length > 0 && <ul>{feature.flows.map((flow) => <li key={flow.id}>{flow.id} · {flow.approved ? 'Approved' : 'Awaiting review'}</li>)}</ul>}
        <div style={actionsStyle}><Button onClick={() => onSelect(feature.slug)}>Review frames</Button><Button variant="secondary" onClick={() => setSelectedSlug(feature.slug)}>Generate flow here</Button></div>
      </article>)}</div>
      <DesignSystemPanel key={projectId} projectId={projectId} latest={workspace.designSystem} token={token} onChanged={(revision) => setWorkspace({ ...workspace, designSystem: revision })} />
      <TraceabilityPanel projectId={projectId} token={token} />
      {features.length > 0 && <>
        <label>Generate in UX area<select value={selectedSlug} onChange={(e) => setSelectedSlug(e.target.value)} style={{ margin: '12px', padding: '8px' }}>{features.map((feature) => <option key={feature.slug} value={feature.slug}>{feature.name}</option>)}</select></label>
        {selectedSlug && <FlowGenerationPanel key={selectedSlug} slug={selectedSlug} token={token} onApplied={reload} />}
      </>}
    </>}
  </section>
}
