import type { FeatureSummary, Manifest, StampInfo } from './types'

// Base-path aware, mirroring the vanilla frontend/app.js exactly: default to
// same-origin (empty base) so the same build works whether design-frames-service
// serves this bundle itself or it's reverse-proxied same-origin under the
// FuzeFront portal (/apps/fuzex/). Never hard-code an absolute API host.
declare global {
  interface Window {
    DESIGN_FRAMES_API_BASE?: string
  }
}

const API_BASE =
  (typeof window !== 'undefined' && window.DESIGN_FRAMES_API_BASE) || ''

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

/** Reads are public; writes require a bearer token (see authHeaders). */
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
