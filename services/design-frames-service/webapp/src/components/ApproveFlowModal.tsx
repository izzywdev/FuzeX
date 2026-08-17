import React, { useState } from 'react'
import { Modal, Input, Button } from '@izzywdev/fuzefront-design-system'

interface ApproveFlowModalProps {
  open: boolean
  flowId: string | null
  submitting: boolean
  onCancel: () => void
  onConfirm: (approvedBy: string) => void
}

/**
 * Replaces the vanilla `window.prompt('Approving as (name/handle):')`. A
 * modal + labeled field is more accessible than a native prompt (which is
 * also unusable while mounted as a federated remote inside another app's
 * document) and gives the same information: who is approving this flow.
 */
export function ApproveFlowModal({
  open,
  flowId,
  submitting,
  onCancel,
  onConfirm,
}: ApproveFlowModalProps) {
  const [approvedBy, setApprovedBy] = useState('')

  if (!open) return null

  const canSubmit = approvedBy.trim().length > 0 && !submitting

  return (
    <Modal open={open} onClose={onCancel} title={`Approve flow "${flowId ?? ''}"`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) onConfirm(approvedBy.trim())
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        <Input
          label="Approving as (name/handle)"
          value={approvedBy}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApprovedBy(e.target.value)}
          placeholder="e.g. izzy"
          autoFocus
          disabled={submitting}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {submitting ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
