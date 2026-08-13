/**
 * Checklists — reusable templates, and the runs made from them.
 *
 * A template is edited here; assigning one creates a TASK with the steps
 * copied in, which then lives in the Tasks tab like anything else. That's why
 * this screen shows active runs underneath the library: a template nobody has
 * assigned is just a document.
 */
import { useMemo, useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Checklist, ChecklistStep } from '@/data/types'
import { Avatar, Badge, Button, EmptyState, Input, Modal, ProgressBar, Select } from '@/components/ui'
import { SavedText } from '@/components/SavedText'
import { ClipboardList, Plus, Send, Trash2 } from 'lucide-react'
import { stepProgress, todayInTz } from '@/domain/tasks'
import { TasksChrome } from './TasksChrome'
import { TaskEditor } from './TasksHome'

export default function ChecklistsHome() {
  const { checklists, tasks, createChecklist } = useData()
  const s = useSession()
  const canEdit = s.can('tasks', 'edit')
  const [editing, setEditing] = useState<Checklist | null>(null)
  const [assigning, setAssigning] = useState<Checklist | null>(null)
  const [openRunId, setOpenRunId] = useState<string | null>(null)

  const runs = useMemo(
    () => tasks.filter((t) => t.checklistId && t.status !== 'done' && t.status !== 'cancelled'),
    [tasks],
  )
  const openRun = tasks.find((t) => t.id === openRunId)

  return (
    <TasksChrome
      title="Checklists"
      subtitle="Reusable step-by-step lists — assign one to somebody and it becomes a task"
      actions={
        canEdit ? (
          <Button
            onClick={async () => {
              const r = await createChecklist({ name: 'New checklist' })
              if (r.ok && r.id) setEditing(checklists.find((c) => c.id === r.id) ?? null)
            }}
          >
            <Plus size={16} /> New checklist
          </Button>
        ) : undefined
      }
    >
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Library</h3>
      {checklists.length === 0 ? (
        <EmptyState>No checklists yet.</EmptyState>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {checklists.map((c) => (
            <li key={c.id} className="card flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <ClipboardList size={18} className="mt-0.5 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-primary">{c.name}</div>
                  {c.category && <Badge tone="neutral">{c.category}</Badge>}
                </div>
              </div>
              {c.description && <p className="text-xs text-muted">{c.description}</p>}
              <p className="text-xs text-faint">
                {c.steps.length} step{c.steps.length === 1 ? '' : 's'}
              </p>
              <div className="mt-auto flex gap-2 pt-1">
                <Button onClick={() => setAssigning(c)} disabled={!canEdit || c.steps.length === 0}>
                  <Send size={15} /> Assign
                </Button>
                <Button variant="ghost" onClick={() => setEditing(c)}>
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-muted">In progress</h3>
      {runs.length === 0 ? (
        <EmptyState>No checklists are running right now.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {runs.map((t) => {
            const p = stepProgress(t.steps)
            const who = s.users.find((u) => u.id === t.assigneeId)
            return (
              <li key={t.id}>
                <button className="card w-full text-left hover:bg-overlay" onClick={() => setOpenRunId(t.id)}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-primary">{t.title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {who && <Avatar user={who} size="xs" isYou={who.id === s.user.id} />}
                      {who?.name ?? 'Unassigned'}
                      {t.dueDate ? ` · due ${t.dueDate}` : ''}
                    </span>
                  </div>
                  {p.fraction != null && (
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar pct={p.fraction * 100} />
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {p.done}/{p.total}
                      </span>
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {editing && <ChecklistEditor checklist={editing} onClose={() => setEditing(null)} />}
      {assigning && <AssignModal checklist={assigning} onClose={() => setAssigning(null)} />}
      {openRun && <TaskEditor task={openRun} onClose={() => setOpenRunId(null)} />}
    </TasksChrome>
  )
}

function ChecklistEditor({ checklist, onClose }: { checklist: Checklist; onClose: () => void }) {
  const { saveChecklist, deleteChecklist } = useData()
  const s = useSession()
  const canEdit = s.can('tasks', 'edit')
  const [steps, setSteps] = useState<ChecklistStep[]>(checklist.steps)
  const [draft, setDraft] = useState('')

  const commit = (next: ChecklistStep[]) => {
    setSteps(next)
    void saveChecklist(checklist.id, { steps: next })
  }

  return (
    <Modal title={checklist.name} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Name</span>
            <SavedText
              value={checklist.name}
              disabled={!canEdit}
              onSave={(v) => void saveChecklist(checklist.id, { name: v })}
            />
          </label>
          <label className="block">
            <span className="label">Category</span>
            <SavedText
              value={checklist.category}
              disabled={!canEdit}
              placeholder="Field, Shop, Season start…"
              onSave={(v) => void saveChecklist(checklist.id, { category: v })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Description</span>
            <SavedText
              value={checklist.description}
              disabled={!canEdit}
              onSave={(v) => void saveChecklist(checklist.id, { description: v })}
            />
          </label>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Steps ({steps.length})
          </h3>
          <p className="mb-2 text-xs text-muted">
            Ordered, but not gated — a crew works through the yard in whatever order it allows, and a list that
            refuses step 4 until step 3 is ticked just teaches people to tick things they haven't done.
          </p>
          <ul className="space-y-1">
            {steps.map((st, i) => (
              <li key={st.id} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-faint">{i + 1}</span>
                <Input
                  className="flex-1"
                  value={st.title}
                  disabled={!canEdit}
                  onChange={(e) =>
                    commit(steps.map((x) => (x.id === st.id ? { ...x, title: e.target.value } : x)))
                  }
                />
                {canEdit && (
                  <button
                    className="rounded p-1 text-faint hover:text-danger"
                    onClick={() => commit(steps.filter((x) => x.id !== st.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {canEdit && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!draft.trim()) return
                commit([
                  ...steps,
                  { id: `new_${Date.now()}`, title: draft.trim(), notes: '', sort: steps.length, required: true },
                ])
                setDraft('')
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a step"
                className="flex-1"
              />
              <Button variant="ghost" type="submit" disabled={!draft.trim()}>
                <Plus size={16} /> Add
              </Button>
            </form>
          )}
        </div>

        {canEdit && (
          <div className="flex border-t border-subtle pt-3">
            <div className="flex-1" />
            <Button
              variant="ghost"
              onClick={async () => {
                await deleteChecklist(checklist.id)
                onClose()
              }}
            >
              <Trash2 size={16} /> Delete checklist
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function AssignModal({ checklist, onClose }: { checklist: Checklist; onClose: () => void }) {
  const { assignChecklist } = useData()
  const s = useSession()
  const [assigneeId, setAssigneeId] = useState<string>(s.user.id)
  const [dueDate, setDueDate] = useState(todayInTz())
  const [title, setTitle] = useState(checklist.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    const r = await assignChecklist({ checklistId: checklist.id, assigneeId, dueDate, title })
    setBusy(false)
    if (r.ok) onClose()
    else setError(r.error ?? 'Could not assign')
  }

  return (
    <Modal title={`Assign — ${checklist.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          This copies the {checklist.steps.length} steps into a new task. Editing the template afterwards won't
          change a run somebody is partway through.
        </p>
        <label className="block">
          <span className="label">Title</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Assign to</span>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {s.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="label">Due</span>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            <Send size={16} /> {busy ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
