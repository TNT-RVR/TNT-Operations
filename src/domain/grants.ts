/**
 * Grant tracker domain helpers — ported from the RVR Management App's
 * `lib/grants.ts` so both apps behave identically. Pure functions only (no
 * React, no backend): status vocabulary, money/date formatting, and the
 * ready-to-paste Claude prompt for drafting an application.
 */

export type GrantStatus = 'new' | 'reviewing' | 'applying' | 'submitted' | 'awarded' | 'declined' | 'ignored'

export const GRANT_STATUSES: GrantStatus[] = [
  'new',
  'reviewing',
  'applying',
  'submitted',
  'awarded',
  'declined',
  'ignored',
]

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  new: 'New',
  reviewing: 'Looked at',
  applying: 'Applying',
  submitted: 'Submitted',
  awarded: 'Awarded',
  declined: 'Declined',
  ignored: 'Ignored',
}

/** "Archived / resolved" = already applied for, awarded, or ruled out. */
export const ARCHIVED_GRANT_STATUSES: GrantStatus[] = ['submitted', 'awarded', 'declined', 'ignored']
export const ACTIVE_GRANT_STATUSES: GrantStatus[] = ['new', 'reviewing', 'applying']
export const isArchivedGrant = (s: GrantStatus): boolean => ARCHIVED_GRANT_STATUSES.includes(s)

/** Status chip tone, mapped to the design-system Badge tones. */
export const GRANT_STATUS_TONE: Record<GrantStatus, 'blue' | 'brand' | 'amber' | 'green' | 'red' | 'neutral'> = {
  new: 'blue',
  reviewing: 'blue',
  applying: 'amber',
  submitted: 'brand',
  awarded: 'green',
  declined: 'neutral',
  ignored: 'neutral',
}

/** "$5,000–$50,000" / "up to $50,000" / "$10,000" / "—". */
export function moneyRange(min: number | null, max: number | null): string {
  const f = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`
  if (min == null && max == null) return '—'
  if (min != null && max != null) return min === 0 ? `up to ${f(max)}` : `${f(min)}–${f(max)}`
  return f((min ?? max)!)
}

/** "Ongoing" / "Mar 3, 2026 · 12d left" / "Closed Jan 2, 2026". */
export function closesLabel(d: string | null, now: Date = new Date()): string {
  if (!d) return 'Ongoing'
  const t = new Date(d + 'T00:00:00').getTime()
  const days = Math.round((t - now.getTime()) / 86_400_000)
  const date = new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  if (days < 0) return `Closed ${date}`
  if (days <= 30) return `${date} · ${days}d left`
  return date
}

/** True when a grant closes within `days` (drives the urgency highlight). */
export function closingSoon(d: string | null, days = 30, now: Date = new Date()): boolean {
  if (!d) return false
  const left = Math.round((new Date(d + 'T00:00:00').getTime() - now.getTime()) / 86_400_000)
  return left >= 0 && left <= days
}

/** The fields the Claude prompt needs (a structural subset of a Grant). */
export interface GrantPromptInput {
  title: string
  funder?: string | null
  url?: string | null
  eligibilitySummary?: string | null
  summary?: string | null
  closesOn?: string | null
  notesMd?: string | null
}

/** A ready-to-paste prompt for drafting the application with Claude. */
export function claudeGrantPrompt(g: GrantPromptInput): string {
  return [
    `I'm applying for a grant for our leafcutter-bee pollination business in southern Alberta (TNT). We provide managed leafcutter bees and bee-shelter placement for hybrid canola and other seed-production fields under contract with seed companies. Help me write a strong application.`,
    ``,
    `GRANT: ${g.title}`,
    g.funder ? `Funder: ${g.funder}` : '',
    g.url ? `Link: ${g.url}` : '',
    g.eligibilitySummary ? `Eligibility: ${g.eligibilitySummary}` : '',
    g.summary ? `Summary: ${g.summary}` : '',
    g.closesOn ? `Closes: ${g.closesOn}` : '',
    g.notesMd ? `\nOur notes:\n${g.notesMd}` : '',
    ``,
    `Please: 1) confirm what this grant funds and the key eligibility criteria, 2) ask me for the specific details you need about our operation, and 3) draft the application answers in a clear, compelling way. Start by listing what you need from me.`,
  ]
    .filter(Boolean)
    .join('\n')
}
