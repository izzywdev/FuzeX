import type { ContentRevision, Discussion, DiscussionComment, DiscussionDetail, DiscussionPage, FeatureSummary, Manifest, RevisionDetail, RevisionFrameRef, StampInfo, Page, Project, ProjectWorkspace, ProjectRepository, DesignSystemRevision, DesignSystemInput, GenerationBrief, GenerationSummary, GenerationDetail } from './types'

// The portal-hosted MFE writes through FuzeFront's same-origin delegated proxy;
// it obtains workload credentials server-side and never exposes them to the
// browser. Standalone/local hosts use an explicit override or their origin.
declare global {
  interface Window {
    DESIGN_FRAMES_API_BASE?: string
  }
}

const API_BASE =
  typeof window === 'undefined' ? '' : window.DESIGN_FRAMES_API_BASE ??
    (window.location.pathname.startsWith('/apps/fuzex/') ? '/api/v1/fuzex' : '')

export class ApiError extends Error {
  status: number
  details?: string[]
  constructor(message: string, status: number, details?: string[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

/** A token is only retained for non-portal automation embeds. Portal writes
 * authenticate with the browser session at the FuzeFront proxy instead. */
export function authHeaders(
  token: string,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  const trimmed = token.trim()
  if (trimmed) headers['Authorization'] = `Bearer ${trimmed}`
  return headers
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(body.error || `HTTP ${res.status}`, res.status, body.details)
  }
  return body as T
}

export function siteFrameUrl(slug: string, file: string): string {
  return `${API_BASE}/site/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`
}

export function listFeatures(): Promise<{ features: FeatureSummary[] }> {
  return api('/api/v1/features')
}

export function getFeature(
  slug: string
): Promise<{ slug: string; manifest: Manifest; frames: Record<string, string> }> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}`)
}

export function getStamp(slug: string): Promise<StampInfo> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/stamp`)
}

export function listRevisions(slug: string): Promise<{ slug: string; revisions: ContentRevision[] }> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/revisions`)
}

export function getRevision(slug: string, stamp: string): Promise<RevisionDetail> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/revisions/${encodeURIComponent(stamp)}`)
}

export function listRevisionFrameRefs(
  slug: string,
  stamp: string
): Promise<{ slug: string; stamp: string; frames: RevisionFrameRef[] }> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/revisions/${encodeURIComponent(stamp)}/frame-refs`)
}

export function listElementDiscussions(targetRef: string, cursor?: string): Promise<DiscussionPage> {
  const query = new URLSearchParams({ targetType: 'element', targetRef })
  if (cursor) query.set('cursor', cursor)
  return api(`/api/v1/discussions?${query.toString()}`)
}

export function getDiscussion(id: string): Promise<DiscussionDetail> {
  return api(`/api/v1/discussions/${encodeURIComponent(id)}`)
}

export function addDiscussionComment(
  id: string,
  body: string,
  token: string,
  parentCommentId?: string
): Promise<DiscussionComment> {
  return api(`/api/v1/discussions/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ body, ...(parentCommentId ? { parentCommentId } : {}) }),
  })
}

export function createElementDiscussion(
  targetRef: string,
  targetSelector: string,
  title: string,
  token: string
): Promise<Discussion> {
  return api('/api/v1/discussions', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ targetType: 'element', targetRef, targetSelector, title }),
  })
}

export function setDiscussionResolved(id: string, resolved: boolean, token: string): Promise<Discussion> {
  return api(`/api/v1/discussions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ resolved }),
  })
}

export function approveFlow(
  slug: string,
  flowId: string,
  approvedBy: string,
  token: string
): Promise<unknown> {
  return api(
    `/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/approve`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ approvedBy }),
    }
  )
}

export function rejectFlow(
  slug: string,
  flowId: string,
  reason: string | undefined,
  token: string
): Promise<unknown> {
  return api(
    `/api/v1/features/${encodeURIComponent(slug)}/flows/${encodeURIComponent(flowId)}/reject`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason }),
    }
  )
}

function pageQuery(cursor?: string): string {
  const query = new URLSearchParams({ limit: '100' })
  if (cursor) query.set('cursor', cursor)
  return query.toString()
}

export function listProjects(cursor?: string): Promise<Page<Project>> {
  return api(`/api/v1/projects?${pageQuery(cursor)}`)
}

export function createProject(name: string, description: string, sourceRepo: string, token: string): Promise<Project> {
  return api('/api/v1/projects', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ name, description: description || null, sourceRepo: sourceRepo || null }),
  })
}

export function getProjectWorkspace(projectId: string): Promise<ProjectWorkspace> {
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/workspace`)
}

export function listProjectFeatures(projectId: string, cursor?: string): Promise<Page<FeatureSummary>> {
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/features?${pageQuery(cursor)}`)
}

export function listProjectRepositories(projectId: string): Promise<{ items: ProjectRepository[] }> {
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/repositories`)
}

export function connectProjectRepository(projectId: string, repository: string, framesPath: string, token: string): Promise<ProjectRepository> {
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/repositories`, {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ repository, framesPath }),
  })
}

export function listDesignSystemRevisions(projectId: string, cursor?: string): Promise<Page<DesignSystemRevision>> {
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/design-system/revisions?${pageQuery(cursor)}`)
}

export function createDesignSystemRevision(projectId: string, input: DesignSystemInput, token: string): Promise<DesignSystemRevision> {
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/design-system/revisions`, {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify(input),
  })
}

export function listGenerations(slug: string): Promise<{ generations: GenerationSummary[] }> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/generations`)
}

export function getGeneration(slug: string, id: string): Promise<GenerationDetail> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/generations/${encodeURIComponent(id)}`)
}

export function createGeneration(slug: string, baseStamp: string, brief: GenerationBrief, token: string): Promise<GenerationDetail> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/generations`, {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ baseStamp, brief }),
  })
}

export function applyGeneration(slug: string, id: string, baseStamp: string, token: string): Promise<GenerationDetail> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/generations/${encodeURIComponent(id)}/apply`, {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ baseStamp }),
  })
}

export function dismissGeneration(slug: string, id: string, token: string): Promise<GenerationDetail> {
  return api(`/api/v1/features/${encodeURIComponent(slug)}/generations/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({}),
  })
}
