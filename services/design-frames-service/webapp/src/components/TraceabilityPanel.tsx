import React, { useEffect, useState } from 'react'
import { Button, StatusCallout } from '@izzywdev/fuzefront-design-system'
import { approveDesignPolicy, createDesignPolicy, createTraceLink, listDesignPolicies, listTraceLinks, supersedeDesignPolicy } from '../api'
import type { DesignPolicy, TraceLink, TraceTargetType } from '../types'
import { errorMessage, panelStyle } from './workspaceStyles'

type Target = { targetType: TraceTargetType; targetRef: string; selector?: string | null; contentStamp?: string | null }

/** The same evidence UI is used for an App and a selected frame component. */
export function TraceabilityPanel({ projectId, token, target, compact = false }: { projectId: string; token: string; target?: Target; compact?: boolean }) {
  const [links, setLinks] = useState<TraceLink[]>([]); const [policies, setPolicies] = useState<DesignPolicy[]>([]); const [error, setError] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<Target>(target ?? { targetType: 'project', targetRef: projectId })
  const reload = () => Promise.all([listTraceLinks(projectId, selectedTarget), compact ? Promise.resolve({ items: [] as DesignPolicy[] }) : listDesignPolicies(projectId)]).then(([l, p]) => { setLinks(l.items); setPolicies(p.items) }).catch((e) => setError(errorMessage(e)))
  useEffect(() => { setSelectedTarget(target ?? { targetType: 'project', targetRef: projectId }) }, [projectId, target?.targetType, target?.targetRef, target?.selector, target?.contentStamp])
  useEffect(() => { void reload() }, [projectId, selectedTarget.targetType, selectedTarget.targetRef, selectedTarget.selector, compact])
  const label = selectedTarget.targetType === 'element' ? `Frame component ${selectedTarget.selector || ''}` : selectedTarget.targetType === 'flowStep' ? `Flow step ${selectedTarget.selector || ''}` : selectedTarget.targetType
  return <section style={panelStyle} aria-labelledby="traceability-heading"><h3 id="traceability-heading">{compact ? `Decision evidence for ${label}` : 'Decision traceability & agent policies'}</h3>
    <p>{compact ? 'This evidence is pinned to the selected immutable frame component.' : 'Link UX decisions to FuzePlan requirements or quotes and FuzeQuality tests. Only explicitly approved policies are available to AI agents.'}</p>
    {error && <StatusCallout tone="error" title="Traceability action failed">{error}</StatusCallout>}
    {!target && <fieldset><legend>Decision target</legend>
      <label>Scope <select value={selectedTarget.targetType} onChange={(event) => setSelectedTarget({ ...selectedTarget, targetType: event.target.value as TraceTargetType, selector: null })}><option value="project">App</option><option value="flow">UX flow</option><option value="flowStep">UX flow step</option><option value="frame">Frame</option><option value="element">Frame component</option><option value="designSystemComponent">Design System component</option></select></label>{' '}
      <label>Target ID <input required value={selectedTarget.targetRef} onChange={(event) => setSelectedTarget({ ...selectedTarget, targetRef: event.target.value })} /></label>{' '}
      {(selectedTarget.targetType === 'element' || selectedTarget.targetType === 'flowStep') && <label>Stable selector / node ID <input required value={selectedTarget.selector || ''} onChange={(event) => setSelectedTarget({ ...selectedTarget, selector: event.target.value })} /></label>}
    </fieldset>}
    <form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const system = String(form.get('system')); const kind = system === 'fuzequality' ? 'test_case' : String(form.get('kind')); createTraceLink(projectId, { ...selectedTarget, sourceSystem: system as 'fuzeplan' | 'fuzequality', sourceKind: kind as 'requirement' | 'llm_quote' | 'test_case', externalRef: String(form.get('reference')), quoteText: kind === 'llm_quote' ? String(form.get('quote')).trim() : null }, token).then(() => { e.currentTarget.reset(); return reload() }).catch((err) => setError(errorMessage(err))) }}>
      <label>Source <select name="system"><option value="fuzeplan">FuzePlan</option><option value="fuzequality">FuzeQuality</option></select></label>{' '}
      <label>Evidence <select name="kind"><option value="requirement">Requirement / Jira ticket</option><option value="llm_quote">LLM quote</option></select></label>{' '}
      <label>Reference <input required name="reference" placeholder="FUZEPLAN-123 or quote id" /></label>{' '}
      <label>Quote <input name="quote" placeholder="Required for LLM quote" /></label>{' '}
      <Button type="submit">Link evidence</Button>
    </form>
    <ul>{links.map((link) => <li key={link.id}><strong>{link.source.system}</strong> · {link.source.kind} · <code>{link.source.externalRef}</code>{link.source.quoteText ? ` — “${link.source.quoteText}”` : ''}</li>)}</ul>
    {!compact && <>
      <form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); createDesignPolicy(projectId, { ...selectedTarget, title: String(form.get('title')), instruction: String(form.get('instruction')), traceLinkIds: links.map((link) => link.id) }, token).then(() => { e.currentTarget.reset(); return reload() }).catch((err) => setError(errorMessage(err))) }}>
        <h4>Draft AI design policy</h4><label>Title <input required name="title" /></label>{' '}<label>Instruction <input required name="instruction" placeholder="Use terms and interaction conventions…" /></label>{' '}<Button type="submit">Save draft</Button>
      </form>
      <ul>{policies.map((policy) => <li key={policy.id}><strong>{policy.status}</strong> · {policy.title} — {policy.instruction} {policy.status === 'draft' && <Button onClick={() => approveDesignPolicy(projectId, policy.id, token).then(reload).catch((err) => setError(errorMessage(err)))}>Approve for agents</Button>} {policy.status !== 'superseded' && <Button variant="secondary" onClick={() => { const instruction = window.prompt('Replacement instruction (the existing policy will be retained as superseded evidence):', policy.instruction); if (!instruction?.trim()) return; supersedeDesignPolicy(projectId, policy.id, { targetType: policy.target.targetType, targetRef: policy.target.targetRef, selector: policy.target.selector, title: policy.title, instruction: instruction.trim(), traceLinkIds: policy.traceLinkIds }, token).then(reload).catch((err) => setError(errorMessage(err))) }}>Supersede</Button>}</li>)}</ul>
    </>}
  </section>
}
