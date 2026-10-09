import React, { useEffect, useState } from 'react'
import { Button, StatusCallout } from '@izzywdev/fuzefront-design-system'
import { approveDesignPolicy, createDesignPolicy, createTraceLink, listDesignPolicies, listTraceLinks } from '../api'
import type { DesignPolicy, TraceLink } from '../types'
import { errorMessage, panelStyle } from './workspaceStyles'

/** Project-level entry point; selected frame/flow/component views pass a more precise target to the same API. */
export function TraceabilityPanel({ projectId, token }: { projectId: string; token: string }) {
  const [links, setLinks] = useState<TraceLink[]>([]); const [policies, setPolicies] = useState<DesignPolicy[]>([]); const [error, setError] = useState('')
  const reload = () => Promise.all([listTraceLinks(projectId), listDesignPolicies(projectId)]).then(([l, p]) => { setLinks(l.items); setPolicies(p.items) }).catch((e) => setError(errorMessage(e)))
  useEffect(() => { void reload() }, [projectId])
  return <section style={panelStyle} aria-labelledby="traceability-heading"><h3 id="traceability-heading">Decision traceability & agent policies</h3>
    <p>Link this app’s UX decisions to FuzePlan requirements or quotes and FuzeQuality tests. Only explicitly approved policies are available to AI agents.</p>
    {error && <StatusCallout tone="error" title="Traceability action failed">{error}</StatusCallout>}
    <form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const system = String(form.get('system')); const kind = system === 'fuzequality' ? 'test_case' : String(form.get('kind')); createTraceLink(projectId, { targetType: 'project', targetRef: projectId, sourceSystem: system as 'fuzeplan' | 'fuzequality', sourceKind: kind as 'requirement' | 'llm_quote' | 'test_case', externalRef: String(form.get('reference')), quoteText: kind === 'llm_quote' ? String(form.get('quote')) : null }, token).then(() => { e.currentTarget.reset(); return reload() }).catch((err) => setError(errorMessage(err))) }}>
      <label>Source <select name="system"><option value="fuzeplan">FuzePlan</option><option value="fuzequality">FuzeQuality</option></select></label>{' '}
      <label>Evidence <select name="kind"><option value="requirement">Requirement / Jira ticket</option><option value="llm_quote">LLM quote</option></select></label>{' '}
      <label>Reference <input required name="reference" placeholder="FUZEPLAN-123 or quote id" /></label>{' '}
      <label>Quote <input name="quote" placeholder="Required when evidence is LLM quote" /></label>{' '}
      <Button type="submit">Link evidence</Button>
    </form>
    <ul>{links.map((link) => <li key={link.id}><strong>{link.source.system}</strong> · {link.source.kind} · <code>{link.source.externalRef}</code>{link.source.quoteText ? ` — “${link.source.quoteText}”` : ''}</li>)}</ul>
    <form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); createDesignPolicy(projectId, { targetType: 'project', targetRef: projectId, title: String(form.get('title')), instruction: String(form.get('instruction')), traceLinkIds: links.map((link) => link.id) }, token).then(() => { e.currentTarget.reset(); return reload() }).catch((err) => setError(errorMessage(err))) }}>
      <h4>Draft AI design policy</h4><label>Title <input required name="title" /></label>{' '}<label>Instruction <input required name="instruction" placeholder="Use terms and interaction conventions…" /></label>{' '}<Button type="submit">Save draft</Button>
    </form>
    <ul>{policies.map((policy) => <li key={policy.id}><strong>{policy.status}</strong> · {policy.title} — {policy.instruction} {policy.status === 'draft' && <Button onClick={() => approveDesignPolicy(projectId, policy.id, token).then(reload).catch((err) => setError(errorMessage(err)))}>Approve for agents</Button>}</li>)}</ul>
  </section>
}
