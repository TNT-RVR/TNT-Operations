import { useMemo, useState } from 'react'
import { Check, ExternalLink, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { PageHeader, Badge, EmptyState, IconButton } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Grant } from '@/data/types'
import {
  ACTIVE_GRANT_STATUSES,
  ARCHIVED_GRANT_STATUSES,
  GRANT_STATUSES,
  GRANT_STATUS_LABEL,
  GRANT_STATUS_TONE,
  claudeChatUrl,
  claudeGrantPrompt,
  claudeUrlWasTruncated,
  closesLabel,
  closingSoon,
  isArchivedGrant,
  moneyRange,
  type GrantStatus,
} from '@/domain/grants'

/**
 * Grants pipeline — funding opportunities for the pollination business, tracked
 * from discovery to award. Ported from the RVR Management App's GrantsPage so
 * both apps work the same way: a status/amount/eligibility/closes table, a
 * detail sheet with notes + assignment + subtasks, and a one-click Claude prompt
 * for drafting the application. Rows arrive from the weekly auto-pull
 * (netlify/functions/grants-pull.mjs) or are added by hand.
 */

function TasksSection({ grantId }: { grantId: string }) {
  const { grantTasks, addGrantTask, updateGrantTask, deleteGrantTask } = useData()
  const s = useSession()
  const tasks = grantTasks.filter((t) => t.grantId === grantId)
  const [title, setTitle] = useState('')
  const [who, setWho] = useState('')

  return (
    <div>
      <h3 className="text-sm font-semibold text-secondary">Tasks &amp; who's doing them</h3>
      <ul className="mt-2 space-y-1.5">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-sm border border-subtle px-2 py-1.5 text-sm">
            <button
              onClick={() => updateGrantTask(t.id, { status: t.status === 'done' ? 'open' : 'done' })}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-xs border"
              style={
                t.status === 'done'
                  ? { background: 'var(--green-500)', borderColor: 'var(--green-500)', color: 'var(--ink-950)' }
                  : { borderColor: 'var(--border-strong)' }
              }
              aria-label="Toggle done"
            >
              {t.status === 'done' && <Check size={12} />}
            </button>
            <span className={`min-w-0 flex-1 truncate ${t.status === 'done' ? 'text-faint line-through' : 'text-primary'}`}>
              {t.title}
            </span>
            <select
              className="input min-h-0 w-32 px-2 py-1 text-xs"
              value={t.assignedTo ?? ''}
              aria-label="Assignee"
              onChange={(e) => updateGrantTask(t.id, { assignedTo: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {s.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <IconButton label="Delete task" onClick={() => deleteGrantTask(t.id)}>
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
        {tasks.length === 0 && <li className="py-1 text-xs text-faint">No tasks yet — add the application steps below.</li>}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          addGrantTask({ grantId, title: title.trim(), status: 'open', assignedTo: who || null })
          setTitle('')
        }}
        className="mt-2 flex flex-wrap gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task / subtask…"
          className="input min-h-0 min-w-0 flex-1 px-2 py-1.5 text-sm"
        />
        <select className="input min-h-0 w-36 px-2 py-1.5 text-sm" value={who} aria-label="Assign to" onChange={(e) => setWho(e.target.value)}>
          <option value="">Unassigned</option>
          {s.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary min-h-0 px-3 py-1.5 text-sm">
          Add
        </button>
      </form>
    </div>
  )
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="label">{label}</p>
    {/* tabular-nums, not font-mono: these facts mix numbers and words (Region),
        so switching typeface made them clash with the rest of the sheet. */}
    <p className="tabular-nums font-medium text-primary">{children}</p>
  </div>
)
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="label">{label}</p>
    {children}
  </div>
)

function GrantDetail({ grant, onClose }: { grant: Grant; onClose: () => void }) {
  const { updateGrant, deleteGrant } = useData()
  const s = useSession()
  const canEdit = s.can('grants', 'edit')
  const [copied, setCopied] = useState<'opened' | 'copied' | null>(null)
  const set = (patch: Partial<Grant>) => updateGrant(grant.id, patch)

  /**
   * Open Claude with the grant's details already in the composer, so the
   * conversation starts on this grant instead of blank. The prompt also goes to
   * the clipboard as a safety net — if it's too long for a URL, or the deep
   * link ever stops accepting `?q=`, it's one paste away.
   */
  const draftWithClaude = async () => {
    const prompt = claudeGrantPrompt({
      title: grant.title,
      funder: grant.funder,
      url: grant.url,
      eligibilitySummary: grant.eligibilitySummary,
      summary: grant.summary,
      closesOn: grant.closesOn,
      notesMd: grant.notesMd,
    })
    const truncated = claudeUrlWasTruncated(prompt)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(truncated ? 'copied' : 'opened')
      setTimeout(() => setCopied(null), 5000)
    } catch {
      setCopied(truncated ? null : 'opened')
      setTimeout(() => setCopied(null), 5000)
    }
    window.open(claudeChatUrl(prompt), '_blank', 'noopener')
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-raised"
        style={{ border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-subtle p-4">
          <div className="min-w-0 flex-1">
            <input
              defaultValue={grant.title}
              disabled={!canEdit}
              onBlur={(e) => e.target.value.trim() && e.target.value !== grant.title && set({ title: e.target.value.trim() })}
              className="w-full rounded-sm border border-transparent bg-transparent font-display text-base font-semibold text-primary hover:border-subtle focus:border-default focus:outline-none"
            />
            <input
              defaultValue={grant.funder ?? ''}
              placeholder="Funder"
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== (grant.funder ?? '') && set({ funder: e.target.value.trim() || null })}
              className="mt-0.5 w-full rounded-sm border border-transparent bg-transparent text-xs text-muted hover:border-subtle focus:border-default focus:outline-none"
            />
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* Status + owner */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input min-h-0 w-36 px-2 py-1.5 text-sm"
              value={grant.status}
              aria-label="Status"
              disabled={!canEdit}
              onChange={(e) => set({ status: e.target.value as GrantStatus })}
            >
              {GRANT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {GRANT_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
            <select
              className="input min-h-0 w-40 px-2 py-1.5 text-sm"
              value={grant.assignedTo ?? ''}
              aria-label="Owner"
              disabled={!canEdit}
              onChange={(e) => set({ assignedTo: e.target.value || null })}
            >
              <option value="">No owner</option>
              {s.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {grant.url && (
              <a
                href={grant.url}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost ml-auto min-h-0 px-2.5 py-1.5 text-xs"
              >
                Open grant <ExternalLink size={14} />
              </a>
            )}
          </div>

          {/* Facts */}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Fact label="Amount">{moneyRange(grant.amountMin, grant.amountMax)}</Fact>
            <Fact label="Closes">{closesLabel(grant.closesOn)}</Fact>
            <Fact label="Region">{grant.region ?? '—'}</Fact>
          </div>

          <Field label="Eligibility">
            <textarea
              defaultValue={grant.eligibilitySummary ?? ''}
              rows={2}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== (grant.eligibilitySummary ?? '') && set({ eligibilitySummary: e.target.value.trim() || null })}
              className="input min-h-0 w-full px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Summary">
            <textarea
              defaultValue={grant.summary ?? ''}
              rows={2}
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== (grant.summary ?? '') && set({ summary: e.target.value.trim() || null })}
              className="input min-h-0 w-full px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Our notes">
            <textarea
              defaultValue={grant.notesMd ?? ''}
              rows={4}
              placeholder="What we think, questions, progress…"
              disabled={!canEdit}
              onBlur={(e) => e.target.value !== (grant.notesMd ?? '') && set({ notesMd: e.target.value.trim() || null })}
              className="input min-h-0 w-full px-2 py-1.5 text-sm"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Closes
              <input
                type="date"
                defaultValue={grant.closesOn ?? ''}
                disabled={!canEdit}
                onBlur={(e) => e.target.value !== (grant.closesOn ?? '') && set({ closesOn: e.target.value || null })}
                className="input min-h-0 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Link
              <input
                defaultValue={grant.url ?? ''}
                placeholder="https://…"
                disabled={!canEdit}
                onBlur={(e) => e.target.value !== (grant.url ?? '') && set({ url: e.target.value.trim() || null })}
                className="input min-h-0 w-56 px-2 py-1 text-sm"
              />
            </label>
          </div>

          <div className="border-t border-subtle pt-3">
            <TasksSection grantId={grant.id} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-subtle p-4">
          {canEdit ? (
            <button
              onClick={() => {
                if (window.confirm('Delete this grant?')) {
                  deleteGrant(grant.id)
                  onClose()
                }
              }}
              className="flex items-center gap-1 text-xs font-medium text-faint transition hover:text-danger"
            >
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <span />
          )}
          <button onClick={draftWithClaude} className="btn-primary min-h-0 px-3 py-2 text-sm">
            <Sparkles size={16} />{' '}
            {copied === 'opened'
              ? 'Opened in Claude'
              : copied === 'copied'
                ? 'Prompt copied — paste into Claude'
                : 'Draft with Claude'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GrantsHome() {
  const { grants, addGrant } = useData()
  const s = useSession()
  const canEdit = s.can('grants', 'edit')
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [statusFilter, setStatusFilter] = useState<'all' | GrantStatus>('all')

  const counts = useMemo(() => {
    let active = 0
    let archived = 0
    for (const g of grants) {
      if (isArchivedGrant(g.status)) archived++
      else active++
    }
    return { active, archived }
  }, [grants])

  const rows = useMemo(
    () =>
      grants
        .filter((g) => (tab === 'archived' ? isArchivedGrant(g.status) : !isArchivedGrant(g.status)))
        .filter((g) => statusFilter === 'all' || g.status === statusFilter),
    [grants, tab, statusFilter],
  )
  const open = grants.find((g) => g.id === openId) ?? null
  const tabStatuses = tab === 'archived' ? ARCHIVED_GRANT_STATUSES : ACTIVE_GRANT_STATUSES

  return (
    <div>
      <PageHeader
        title="Grants"
        subtitle="Bee &amp; small-business funding — track, assign, and draft with Claude"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input min-h-0 w-36 px-2 py-1.5 text-sm"
              value={statusFilter}
              aria-label="Filter status"
              onChange={(e) => setStatusFilter(e.target.value as 'all' | GrantStatus)}
            >
              <option value="all">{tab === 'archived' ? 'All archived' : 'All active'}</option>
              {tabStatuses.map((st) => (
                <option key={st} value={st}>
                  {GRANT_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
            {canEdit && (
              <button
                className="btn-primary min-h-0 px-3 py-1.5 text-sm"
                onClick={async () => {
                  const id = await addGrant({ title: 'New grant' })
                  if (id) setOpenId(id)
                }}
              >
                <Plus size={14} /> Add grant
              </button>
            )}
          </div>
        }
      />

      <div className="p-4 md:p-6">
        {/* Active vs Archived tabs */}
        <div className="mb-4 flex gap-1 border-b border-subtle">
          {(
            [
              ['active', 'Active', counts.active],
              ['archived', 'Archived', counts.archived],
            ] as const
          ).map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key)
                setStatusFilter('all')
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-secondary'
              }`}
            >
              {label} <span className="ml-1 font-mono tabular text-xs text-faint">{n}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-subtle">
          <table className="w-full min-w-[820px] border-collapse bg-raised text-sm">
            <thead>
              <tr>
                <th className="th">Status</th>
                <th className="th">Grant</th>
                <th className="th">Amount</th>
                <th className="th">Eligible</th>
                <th className="th">Closes</th>
                <th className="th">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr
                  key={g.id}
                  onClick={() => setOpenId(g.id)}
                  className="cursor-pointer border-t border-subtle transition hover:bg-[color:var(--hover-wash)]"
                >
                  <td className="px-3 py-2">
                    <Badge tone={GRANT_STATUS_TONE[g.status]}>{GRANT_STATUS_LABEL[g.status]}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-primary">{g.title}</p>
                    <p className="text-xs text-faint">{g.funder ?? ''}</p>
                  </td>
                  {/* tabular-nums aligns the digits WITHOUT switching typeface —
                      font-mono here made this the only column in a different font. */}
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-secondary">
                    {moneyRange(g.amountMin, g.amountMax)}
                  </td>
                  <td className="max-w-xs px-3 py-2 text-xs text-muted">
                    <span className="line-clamp-2">{g.eligibilitySummary ?? '—'}</span>
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2 text-xs"
                    style={closingSoon(g.closesOn) ? { color: 'var(--warn-fg)' } : { color: 'var(--text-secondary)' }}
                  >
                    {closesLabel(g.closesOn)}
                  </td>
                  <td className="px-3 py-2">
                    {g.url ? (
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open the grant website"
                        aria-label={`Open ${g.title} website`}
                        className="btn-ghost inline-flex min-h-0 px-2 py-1 text-xs"
                      >
                        Website <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-6">
              <EmptyState>No grants{statusFilter !== 'all' ? ' with that status' : ' yet'}.</EmptyState>
            </div>
          )}
        </div>
      </div>

      {open && <GrantDetail grant={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
