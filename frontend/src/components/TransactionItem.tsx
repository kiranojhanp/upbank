import type { Transaction } from '../types'
import { formatAmount } from '../format'

interface TransactionItemProps {
  transaction: Transaction
  categoryMap: Record<string, string>
  isJoint: boolean
  onOpen: (transaction: Transaction) => void
}

function TransactionIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.43359 24.204C13.064 24.2238 17.6894 24.2486 22.3198 24.2684C22.2553 20.7337 22.1958 16.6486 22.1314 13.1138C17.7191 13.0494 13.3019 12.98 8.88969 12.9156C8.74096 14.0112 8.6666 15.1118 8.68147 16.2173L8.43359 24.204Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.2672 12.8908C10.2672 11.4878 10.2176 9.89145 10.6737 8.63222C10.9514 7.86875 11.5165 7.22921 12.1808 6.75824C13.326 5.95015 14.7737 5.62296 16.1766 5.71716C16.8558 5.76177 17.54 5.9006 18.12 6.25258C18.9231 6.73347 19.4586 7.56634 19.761 8.44879C20.0634 9.33124 20.2419 10.2682 20.3311 11.2002C20.3906 11.7902 20.4203 12.2116 20.4203 12.8015"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.508 12.8114C18.508 11.7257 18.3642 10.878 18.0817 9.83192C17.9131 9.21222 17.6652 8.56278 17.1348 8.19096C16.8125 7.96291 16.4209 7.86376 16.0342 7.7894C15.3104 7.65554 14.5072 7.62084 13.8826 8.00753C13.4364 8.28516 13.02 8.67186 12.7919 9.13788C12.2069 10.3227 12.1524 11.5621 12.1821 12.9156"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.7259 16.6685C15.7904 18.1111 15.721 19.5637 15.5078 20.9915"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RoundUpIcon({ value }: { value: string }) {
  return (
    <svg
      style={{ width: '0.85rem' }}
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
    >
      <title>{`Round up: ${value}`}</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M18 36C27.9409 36 36 27.9409 36 18C36 8.05908 27.9409 0 18 0C8.05908 0 0 8.05908 0 18C0 27.9409 8.05908 36 18 36ZM18 32C25.7319 32 32 25.7319 32 18C32 10.2681 25.7319 4 18 4C10.2681 4 4 10.2681 4 18C4 25.7319 10.2681 32 18 32Z"
        fill="#FF7A64"
      />
      <path d="M17.6536 7.1C17.8076 6.83333 18.1925 6.83333 18.3464 7.1L28.0459 23.9C28.1999 24.1667 28.0074 24.5 27.6995 24.5H8.30052C7.9926 24.5 7.80015 24.1667 7.95411 23.9L17.6536 7.1Z" fill="#FF7A64" />
    </svg>
  )
}

export function TransactionItem({ transaction, categoryMap, isJoint, onOpen }: TransactionItemProps) {
  const { attributes } = transaction
  const meta: string[] = [new Date(attributes.createdAt).toLocaleTimeString()]
  if (attributes.message) meta.push(attributes.message)

  const catId = transaction.relationships?.category?.data?.id
  if (catId && categoryMap[catId]) meta.push(categoryMap[catId])

  const tags = transaction.relationships?.tags?.data?.map((tag) => tag.id) ?? []
  const { text, cls } = formatAmount(attributes.amount.value)

  return (
    <div className="transaction-item" data-transaction-id={transaction.id} onClick={() => onOpen(transaction)}>
      <div className="transaction-icon">
        <TransactionIcon />
      </div>

      <div className="transaction-details">
        <p className="transaction-description">{attributes.description}</p>
        <div className="transaction-status">{meta.join(' · ')}</div>

        {isJoint && attributes.performingCustomer?.displayName && (
          <div className="transaction-performer">
            {attributes.performingCustomer.displayName}
          </div>
        )}

        {tags.length > 0 && (
          <div className="tag-row">
            {tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="transaction-amount">
        {attributes.roundUp && (
          <div className="round-up">
            <RoundUpIcon value={attributes.roundUp.amount.value} />
          </div>
        )}
        <p className={`amount ${cls}`}>{text}</p>
        {attributes.status === 'HELD' && (
          <div className="status-badge status-held">Pending</div>
        )}
      </div>
    </div>
  )
}
