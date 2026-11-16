export interface Money {
  value: string
  currencyCode?: string
  valueInBaseUnits?: number
}

export interface AccountAttributes {
  displayName: string
  accountType: string
  ownershipType: string
  balance: Money & { currencyCode: string }
}

export interface Account {
  id: string
  attributes: AccountAttributes
}

export interface TransactionRelationships {
  category?: { data?: { id: string } | null }
  tags?: { data?: { id: string }[] }
}

export interface TransactionAttributes {
  description: string
  message?: string | null
  createdAt: string
  settledAt?: string | null
  status: 'SETTLED' | 'HELD' | string
  amount: Money & { valueInBaseUnits: number }
  roundUp?: { amount: Money } | null
  cashback?: { amount: Money } | null
  holdInfo?: { amount: Money } | null
  foreignAmount?: { value: string; currencyCode: string } | null
  cardPurchaseMethod?: { method: string } | null
  performingCustomer?: { displayName?: string } | null
  rawText?: string | null
}

export interface Transaction {
  id: string
  attributes: TransactionAttributes
  relationships?: TransactionRelationships
}

export interface TransactionsResponse {
  transactions: Transaction[]
  nextPage: string | null
  categoryMap: Record<string, string>
}

export interface NextTransactionsResponse {
  transactions: Transaction[]
  nextPage: string | null
}

export interface AccountsResponse {
  accounts: Account[]
}

export interface TransactionFilters {
  status?: string
  since?: string
  until?: string
}
