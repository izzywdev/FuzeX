import React, { useState } from 'react'
import { Modal, Textarea, Button } from '@izzywdev/fuzefront-design-system'

interface RejectFlowModalProps {
  open: boolean
  flowId: string | null
  submitting: boolean
  onCancel: () => void
  onConfirm: (reason: string | undefined) => void
}

/**
 * Replaces the vanilla `window.prompt('Reason for revoking approval
 * (optional):')`. Reason is optional, matching the API contract (reject body
 * `{ reason? }`).
 */
export function RejectFlowModal({
  open,
  flowId,
  submitting,
  onCancel,
  onConfirm,
}: RejectFlowModalProps) {
  const [reason, setReason] = useState('')

  if (!open) return null

  return (
    <Modal open={open} onClose={onCancel} title={`Revoke approval for "${flowId ?? ''}"`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!submitting) onConfirm(reason.trim() || undefined)
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        <Textarea
          label="Reason (optional)"
          value={reason}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          placeholder="Why is this flow's approval being revoked?"
          rows={3}
          disabled={submitting}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={submitting}>
            {submitting ? 'Revoking…' : 'Revoke'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
