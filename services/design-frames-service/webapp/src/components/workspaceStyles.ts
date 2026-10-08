import type { CSSProperties } from 'react'

export const panelStyle: CSSProperties = {
  padding: 'var(--space-4, 16px)', border: '1px solid var(--border-color, #414753)',
  borderRadius: 'var(--radius-md, 8px)', marginBottom: 'var(--space-4, 16px)',
}
export const fieldStyle: CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', padding: '10px', marginTop: '4px',
  color: 'var(--text-primary)', background: 'var(--bg-secondary, #202631)',
  border: '1px solid var(--border-color, #414753)', borderRadius: '4px', font: 'inherit',
}
export const gridStyle: CSSProperties = { display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }
export const actionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '12px' }
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'The request failed. Please retry.'
