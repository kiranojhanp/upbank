import { useEffect, useState } from 'react'
import { localDateIso } from './budget'

/**
 * The local calendar date, refreshed while the app stays open.
 *
 * "Weeks until due" and catch-up are relative to today, so a tab left open
 * overnight (or across midnight on payday) must not keep yesterday's answer.
 * The timer only runs once a minute and re-renders nothing unless the date
 * string actually changes.
 */
export function useToday(): string {
  const [today, setToday] = useState(localDateIso)

  useEffect(() => {
    const tick = () => setToday(localDateIso())
    const timer = window.setInterval(tick, 60_000)
    const onVisible = () => {
      if (!document.hidden) tick()
    }
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return today
}
