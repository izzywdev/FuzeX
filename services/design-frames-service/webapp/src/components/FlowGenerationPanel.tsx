import React, { useEffect, useState } from 'react'
import { Button, StatusCallout } from '@izzywdev/fuzefront-design-system'
import { ApiError, applyGeneration, createGeneration, dismissGeneration, getGeneration, getStamp, listGenerations } from '../api'
import type { GenerationBrief, GenerationDetail, GenerationSummary } from '../types'
import { actionsStyle, errorMessage, fieldStyle, gridStyle, panelStyle } from './workspaceStyles'

export function FlowGenerationPanel({ slug, token, onApplied }: { slug: string; token: string; onApplied: () => void }) {
  const [brief, setBrief] = useState<GenerationBrief>({ flowId: '', title: '', goal: '', steps: [{ title: '', description: '' }] })
  const [generations, setGenerations] = useState<GenerationSummary[]>([])
  const [detail, setDetail] = useState<GenerationDetail | null>(null)
  const [frame, setFrame] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true); setDetail(null); setError(''); setNotice('')
    listGenerations(slug).then((result) => { if (active) setGenerations(result.generations) })
      .catch((err) => { if (active) setError(errorMessage(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [slug])

  async function run(action: () => Promise<GenerationDetail>) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await action()
      setDetail(result); setFrame(0)
      setGenerations((await listGenerations(slug)).generations)
      return result
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409
        ? `${err.message}. The feature changed or the flow key already exists. Create a new draft using a unique flow key and the latest feature.`
        : errorMessage(err))
    } finally { setBusy(false) }
  }

  function updateStep(index: number, key: 'title' | 'description' | 'action', value: string) {
    setBrief((current) => ({ ...current, steps: current.steps.map((step, i) => i === index ? { ...step, [key]: value } : step) }))
  }

  return <section aria-labelledby="generation-heading" style={panelStyle}>
    <h3 id="generation-heading">Generate a UX flow</h3>
    <p>Describe a goal and its screens to create a draft wireframe scaffold. Review every screen before publishing; published flows still require approval.</p>
    {error && <StatusCallout tone="error" title="Generation request failed">{error}</StatusCallout>}
    {notice && <p role="status">{notice}</p>}
    <form onSubmit={(event) => {
      event.preventDefault()
      void run(async () => {
        const { stamp } = await getStamp(slug)
        return createGeneration(slug, stamp, {
          ...brief, ...(brief.audience?.trim() ? { audience: brief.audience.trim() } : { audience: undefined }),
          steps: brief.steps.map((step) => ({ title: step.title, description: step.description, ...(step.action?.trim() ? { action: step.action.trim() } : {}) })),
        }, token)
      })
    }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <div style={gridStyle}>
          <label>Flow key<input style={fieldStyle} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} placeholder="team-onboarding" value={brief.flowId} onChange={(e) => setBrief({ ...brief, flowId: e.target.value })} /></label>
          <label>Flow title<input style={fieldStyle} required maxLength={160} value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} /></label>
          <label>Audience (optional)<input style={fieldStyle} maxLength={500} value={brief.audience || ''} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} /></label>
        </div>
        <label>Goal<textarea style={fieldStyle} required maxLength={2000} value={brief.goal} onChange={(e) => setBrief({ ...brief, goal: e.target.value })} /></label>
        {brief.steps.map((step, index) => <fieldset key={index} style={{ ...panelStyle, marginTop: '12px' }}>
          <legend>Screen {index + 1}</legend>
          <label>Screen title<input style={fieldStyle} required maxLength={160} value={step.title} onChange={(e) => updateStep(index, 'title', e.target.value)} /></label>
          <label>What should this screen show?<textarea style={fieldStyle} required maxLength={2000} value={step.description} onChange={(e) => updateStep(index, 'description', e.target.value)} /></label>
          <label>Primary action (optional)<input style={fieldStyle} maxLength={160} value={step.action || ''} onChange={(e) => updateStep(index, 'action', e.target.value)} /></label>
          {brief.steps.length > 1 && <Button type="button" variant="secondary" onClick={() => setBrief({ ...brief, steps: brief.steps.filter((_, i) => i !== index) })}>Remove screen {index + 1}</Button>}
        </fieldset>)}
        <div style={actionsStyle}>
          <Button type="button" variant="secondary" disabled={brief.steps.length >= 12} onClick={() => setBrief({ ...brief, steps: [...brief.steps, { title: '', description: '' }] })}>Add screen</Button>
          <Button type="submit" disabled={!token.trim() || busy}>{busy ? 'Working…' : 'Generate draft'}</Button>
        </div>
        {!token.trim() && <p>Sign in with write access to generate or publish drafts.</p>}
      </fieldset>
    </form>
    <h4>Draft history</h4>
    {loading ? <p role="status">Loading draft history…</p> : generations.length === 0 ? <p>No generated drafts yet.</p> : <ul>
      {generations.map((generation) => <li key={generation.id} style={{ marginBottom: '8px' }}>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => getGeneration(slug, generation.id))}>{generation.title}</Button>
        {' '}{generation.status} · {generation.frameCount} screens · {new Date(generation.createdAt).toLocaleString()}
      </li>)}
    </ul>}
    {detail && <section aria-label="Generated draft preview" style={panelStyle}>
      <h4>{detail.draft.brief.title} · {detail.status}</h4>
      <p>{detail.draft.brief.goal}</p>
      <p>This draft was produced with the wireframe scaffold generator. Design system context: {detail.draft.designSystem || 'None'}.</p>
      <label>Preview screen<select style={fieldStyle} value={frame} onChange={(e) => setFrame(Number(e.target.value))}>
        {detail.draft.frames.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.label}</option>)}
      </select></label>
      {detail.draft.frames[frame] && <iframe title={`Draft: ${detail.draft.frames[frame].label}`} sandbox="" srcDoc={detail.draft.frames[frame].html} style={{ width: '100%', height: '500px', border: '1px solid var(--border-color)', marginTop: '12px', background: 'white' }} />}
      {detail.status === 'draft' && <div style={actionsStyle}>
        <Button disabled={busy || !token.trim()} onClick={() => void run(async () => {
          const result = await applyGeneration(slug, detail.id, detail.baseStamp, token)
          setNotice('Flow published as a new revision. It is awaiting review and approval.'); onApplied()
          return result
        })}>Publish for review</Button>
        <Button variant="secondary" disabled={busy || !token.trim()} onClick={() => void run(() => dismissGeneration(slug, detail.id, token))}>Dismiss draft</Button>
      </div>}
      {detail.status === 'applied' && <p>Published revision: <code>{detail.resultStamp}</code></p>}
    </section>}
  </section>
}
