import type { DesignSystemComponent } from './types'

export type ComponentReviewStatus = NonNullable<DesignSystemComponent['status']>

export interface DesignSystemReviewSummary {
  draft: number
  approved: number
  rejected: number
}

/** Keep the editor's validation independent from the API so authors get an
 * actionable error before a revision is created. */
export function validateDesignSystemDraft(
  name: string,
  tokens: unknown,
  components: DesignSystemComponent[]
): string | null {
  if (!name.trim()) return 'Provide a name for this design system revision.'
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return 'Tokens must be a JSON object.'

  const keys = new Set<string>()
  for (const component of components) {
    if (!component.key.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(component.key)) {
      return 'Every component needs a stable key using letters, numbers, dots, underscores, or hyphens.'
    }
    if (!component.name.trim()) return 'Every component needs a display name.'
    if (keys.has(component.key)) return `Component key "${component.key}" is used more than once.`
    keys.add(component.key)
  }
  return null
}

export function summarizeComponentReviews(components: DesignSystemComponent[]): DesignSystemReviewSummary {
  return components.reduce<DesignSystemReviewSummary>((summary, component) => {
    summary[component.status || 'draft'] += 1
    return summary
  }, { draft: 0, approved: 0, rejected: 0 })
}

/** A concise text value suitable for status badges and assistive technology. */
export function reviewStatusLabel(status: ComponentReviewStatus | undefined): string {
  return status === 'approved' ? 'Approved' : status === 'rejected' ? 'Changes requested' : 'Draft'
}
