export function fmt(value: string | number): string {
  return parseFloat(String(value)).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatAmount(value: string): { text: string; cls: 'debit' | 'credit' } {
  if (value.startsWith('-')) {
    return { text: `-$${fmt(value.substring(1))}`, cls: 'debit' }
  }
  return { text: `+$${fmt(value)}`, cls: 'credit' }
}

export function accountTypeLabel(accountType: string): string {
  return accountType.replace('_', ' ')
}

/** "just now", "4m ago", "3h ago", "2d ago", or a short date. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export function groupByDate<T extends { attributes: { createdAt: string } }>(
  items: T[],
): { date: string; items: T[] }[] {
  const groups: Record<string, T[]> = {}
  for (const item of items) {
    const date = new Date(item.attributes.createdAt).toDateString()
    if (!groups[date]) groups[date] = []
    groups[date].push(item)
  }
  return Object.entries(groups).map(([date, groupItems]) => ({ date, items: groupItems }))
}
