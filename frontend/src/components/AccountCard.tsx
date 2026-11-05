import type { Account } from '../types'
import { accountTypeLabel, fmt } from '../format'
import { UpLogo } from './UpLogo'

interface AccountCardProps {
  account: Account
  index: number
  selected: boolean
  blurred: boolean
  onSelect: (account: Account) => void
}

export function AccountCard({ account, index, selected, blurred, onSelect }: AccountCardProps) {
  const { attributes } = account

  return (
    <div
      className={`card card-color-${(index % 5) + 1}${selected ? ' selected' : ''}`}
      data-account-id={account.id}
      data-ownership={attributes.ownershipType}
      onClick={() => onSelect(account)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(account)
        }
      }}
    >
      <div className="card-badge">{accountTypeLabel(attributes.accountType)}</div>
      <div className="card-name">{attributes.displayName}</div>
      <div className="card-balance-row">
        <span className={`balance-amount${blurred ? ' blurred' : ''}`}>
          {fmt(attributes.balance.value)}
        </span>
        <span className="balance-currency">{attributes.balance.currencyCode}</span>
      </div>
    </div>
  )
}

export function SidebarBrand() {
  return (
    <div className="sidebar-brand">
      <div className="brand-logo">
        <UpLogo />
      </div>
      <div className="brand-text">
        <div className="brand-name">Unofficial Up</div>
      </div>
    </div>
  )
}
