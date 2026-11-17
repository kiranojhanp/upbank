/** Per-user app settings stored locally alongside the plan and paid history. */
export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface AppSettings {
  weekStartsOn: WeekStartsOn
}

export const DEFAULT_SETTINGS: AppSettings = { weekStartsOn: 3 }

export const WEEKDAY_OPTIONS: { value: WeekStartsOn; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

const SETTINGS_VERSION = 1
const SETTINGS_PREFIX = 'up:settings:'

export function settingsKey(uid: string): string {
  return `${SETTINGS_PREFIX}${uid}`
}

function isWeekStartsOn(value: unknown): value is WeekStartsOn {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
  )
}

export function sanitizeSettings(value: unknown): AppSettings | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as { version?: unknown; weekStartsOn?: unknown }
  if (record.version !== SETTINGS_VERSION) return null
  if (!isWeekStartsOn(record.weekStartsOn)) return null
  return { weekStartsOn: record.weekStartsOn }
}

export function readSettings(uid: string): AppSettings {
  try {
    const raw = localStorage.getItem(settingsKey(uid))
    if (!raw) return DEFAULT_SETTINGS
    return sanitizeSettings(JSON.parse(raw)) ?? DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeSettings(uid: string, settings: AppSettings): boolean {
  try {
    localStorage.setItem(
      settingsKey(uid),
      JSON.stringify({ version: SETTINGS_VERSION, weekStartsOn: settings.weekStartsOn }),
    )
    return true
  } catch {
    return false
  }
}

export function weekStartsOnLabel(value: WeekStartsOn): string {
  return WEEKDAY_OPTIONS.find((option) => option.value === value)?.label ?? 'Wednesday'
}
