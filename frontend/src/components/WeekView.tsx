import { useMemo, useState } from 'react'
import { addDaysIso } from '../budget'
import type { Account } from '../types'
import { useToday } from '../useToday'
import {
  endOfWeek,
  formatWeekDay,
  formatWeekRange,
  startOfWeek,
  weekDayCells,
  weekRelativeLabel,
} from '../week'
import { WeekBoard } from './WeekBoard'

interface WeekViewProps {
  uid: string
  accounts: Account[]
  online: boolean
  onNotify: (label: string, description?: string) => void
  onOpenPlan: () => void
  onSessionExpired: () => void
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

export function WeekView({
  uid,
  accounts,
  online,
  onNotify,
  onOpenPlan,
  onSessionExpired,
}: WeekViewProps) {
  const today = useToday()
  const currentWeekStart = useMemo(() => startOfWeek(today), [today])
  const [weekStart, setWeekStart] = useState(currentWeekStart)

  const days = weekDayCells(weekStart, today)
  const current = weekStart === currentWeekStart
  const weekEnd = endOfWeek(weekStart)

  return (
    <section id="week-section" aria-labelledby="week-title">
      <header className="week-header">
        <div className="week-heading">
          <p className="week-eyebrow">{weekRelativeLabel(weekStart, today)}</p>
          <h2 id="week-title" className="week-title">
            {formatWeekRange(weekStart)}
          </h2>
          <p className="week-subtitle">
            Pick a budget entry, then click one of this week&apos;s transactions to attach it.
          </p>
        </div>
        <div className="week-header-actions">
          {!current && (
            <button
              type="button"
              className="plan-btn plan-btn-ghost"
              onClick={() => setWeekStart(currentWeekStart)}
            >
              This week
            </button>
          )}
          <button type="button" className="plan-btn plan-btn-ghost" onClick={onOpenPlan}>
            Set-aside plan
          </button>
        </div>
      </header>

      <div className="week-strip">
        <button
          type="button"
          className="week-arrow"
          aria-label="Previous week"
          onClick={() => setWeekStart(addDaysIso(weekStart, -7))}
        >
          <Chevron direction="left" />
        </button>

        <div className="week-days" role="group" aria-label="Days in this week">
          {days.map((day) => (
            <div
              key={day.iso}
              className={`week-day${day.isToday ? ' is-today' : ''}`}
              title={formatWeekDay(day.iso)}
              aria-current={day.isToday ? 'date' : undefined}
            >
              <span>{day.weekday}</span>
              <b>{day.day}</b>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="week-arrow"
          aria-label="Next week"
          onClick={() => setWeekStart(addDaysIso(weekStart, 7))}
        >
          <Chevron direction="right" />
        </button>
      </div>

      <WeekBoard
        key={`${uid}:${weekStart}`}
        uid={uid}
        weekStart={weekStart}
        weekEnd={weekEnd}
        accounts={accounts}
        online={online}
        onNotify={onNotify}
        onOpenPlan={onOpenPlan}
        onSessionExpired={onSessionExpired}
      />
    </section>
  )
}
