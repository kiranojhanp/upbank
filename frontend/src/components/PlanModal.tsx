import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'

interface PlanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** Wider layout for the import preview. */
  wide?: boolean
}

/**
 * Shared dialog shell for the plan view. Radix supplies the focus trap, Escape
 * handling, scroll lock and focus restoration; the styling is the app's own
 * dark theme rather than shadcn's light semantic tokens.
 */
export function PlanModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: PlanModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="plan-overlay" />
        <Dialog.Content className={`plan-modal${wide ? ' plan-modal-wide' : ''}`}>
          <div className="plan-modal-head">
            <div className="plan-modal-heading">
              <Dialog.Title className="plan-modal-title">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="plan-modal-desc">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button type="button" className="plan-modal-close" aria-label="Close dialog">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </Dialog.Close>
          </div>

          <div className="plan-modal-body">{children}</div>

          {footer && <div className="plan-modal-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
