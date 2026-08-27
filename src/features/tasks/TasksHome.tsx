/**
 * Tasks — the list, and the editor behind it.
 *
 * Touch-first: rows are big enough to tick with a thumb, and the checkbox is
 * the largest target on the row, because on a field phone that is the only
 * thing most people ever press.
 */
import { useMemo, useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Task, TaskStatus } from '@/data/types'
import { Avatar, Badge, Button, EmptyState, Input, Modal, ProgressBar, Select } from '@/components/ui'
import { SavedText } from '@/components/SavedText'
import { CheckCircle2, Circle, CloudOff, Plus, RefreshCw, Repeat, Trash2 } from 'lucide-react'
import {
  DUE_ORDER,
  type RecurUnit,
  daysOverdue,
  describeRecurrence,
  dueStatus,
  stepProgress,
  todayInTz,
} from '@/domain/tasks'
import { TasksChrome } from './TasksChrome'

const DUE_TONE: Record<string, 'neutral' | 'green' | 'amber' | 'red'> = {
  overdue: 'red',
  'due-today': 'amber',
  'due-soon': 'amber',
  upcoming: 'neutral',
  'no-date': 'neutral',
  done: 'green',
}

export default function TasksHome() {
  const { tasks, createTask } = useData()
  const s = useSession()
  const canEdit = s.can('tasks', 'edit')
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [showDone, setShowDone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const today = todayInTz()

  const rows = useMemo(() => {
    return tasks
      .filter((t) => (scope === 'mine' ? t.assigneeId === s.user.id : true))
      .filter((t) => (showDone ? true : t.status !== 'done' && t.status !== 'cancelled'))
      .map((t) => ({ task: t, status: dueStatus({ ...t, remindDaysBefore: t.remindDaysBefore }, today) }))
      .sort((a, b) => {
        const d = DUE_ORDER[a.status] - DUE_ORDER[b.status]
        if (d !== 0) return d
        // Within a bucket, soonest first; undated last.
        return (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999')
      })
  }, [tasks, scope, showDone, s.user.id, today])

  const open = tasks.find((t) => t.id === openId)

  return (
    <TasksChrome
      title="Tasks"
      subtitle="What needs doing, who has it, and when it's due"
      actions={
        canEdit ? (
          <Button
            onClick={async () => {
              const r = await createTask({ title: 'New task', assigneeId: s.user.id })
              if (r.ok && r.id) setOpenId(r.id)
            }}
          >
            <Plus size={16} /> New task
          </Button>
        ) : undefined
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-subtle">
          {(['mine', 'all'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setScope(v)}
              className={`px-3 py-1.5 text-sm capitalize ${
 scope === v ? 'bg-brand text-on-brand' : 'text-secondary hover:bg-overlay'
              }`}
            >
              {v === 'mine' ? 'Mine' : 'Everyone'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show completed
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          {scope === 'mine' ? 'Nothing assigned to you right now.' : 'No open tasks.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ task, status }) => (
            <TaskRow key={task.id} task={task} status={status} today={today} onOpen={() => setOpenId(task.id)} />
          ))}
        </ul>
      )}

      {open && <TaskEditor task={open} onClose={() => setOpenId(null)} />}
    </TasksChrome>
  )
}

function TaskRow({
  task,
  status,
  today,
  onOpen,
}: {
  task: Task
  status: string
  today: string
  onOpen: () => void
}) {
  const { setTaskStatus, checklists } = useData()
  const progress = stepProgress(task.steps)
  const late = daysOverdue(task, today)
  const checklist = task.checklistId ? checklists.find((c) => c.id === task.checklistId) : null
  const done = task.status === 'done'

  return (
    <li className="card flex items-start gap-3">
      {/* Biggest target on the row — it's what gets pressed in the field. */}
      <button
        className="-m-2 shrink-0 p-2 text-faint hover:text-brand"
        aria-label={done ? 'Reopen task' : 'Mark done'}
        onClick={() => void setTaskStatus(task.id, done ? 'open' : 'done')}
      >
        {done ? <CheckCircle2 size={26} className="text-brand" /> : <Circle size={26} />}
      </button>

      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={`font-medium ${done ? 'text-faint line-through' : 'text-primary'}`}>{task.title}</span>
          {task.priority === 'high' && <Badge tone="red">High</Badge>}
          {checklist && <Badge tone="neutral">Checklist</Badge>}
          {task.recurUnit && (
            <span className="flex items-center gap-1 text-xs text-faint">
              <Repeat size={12} />
              {describeRecurrence({
                unit: task.recurUnit,
                interval: task.recurInterval,
                anchor: task.recurAnchor,
                weekdays: task.recurWeekdays,
                until: task.recurUntil,
              })}
            </span>
          )}
        </div>

        {progress.fraction != null && (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar pct={progress.fraction * 100} />
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {progress.done}/{progress.total}
            </span>
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Assignee id={task.assigneeId} />
          {task.dueDate && (
            <Badge tone={DUE_TONE[status] ?? 'neutral'}>
              {status === 'overdue' ? `${late} day${late === 1 ? '' : 's'} overdue` : `Due ${task.dueDate}`}
            </Badge>
          )}
        </div>
      </button>
    </li>
  )
}

/** A user's photo and name from their id — falls back to "Unassigned". */
function Assignee({ id }: { id: string | null }) {
  const s = useSession()
  if (!id) return <span className="text-faint">Unassigned</span>
  const u = s.users.find((x) => x.id === id)
  if (!u) return <span>Someone</span>
  return (
    <span className="flex items-center gap-1.5">
      <Avatar user={u} size="xs" isYou={u.id === s.user.id} />
      {u.name}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor
// ═══════════════════════════════════════════════════════════════════════════

const UNITS: Array<{ value: RecurUnit | ''; label: string }> = [
  { value: '', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const { saveTask, deleteTask, setTaskStatus, addStep, setStepComplete, deleteStep, saveStep, pendingSync } =
    useData()
  const s = useSession()
  const canEdit = s.can('tasks', 'edit')
  const mine = task.assigneeId === s.user.id
  const [newStep, setNewStep] = useState('')
  const progress = stepProgress(task.steps)

  const patch = (p: Partial<Task>) => void saveTask(task.id, p)

  return (
    <Modal title={task.title} onClose={onClose} wide>
      <div className="space-y-5">
        {pendingSync > 0 && (
          <p className="flex items-center gap-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
            <CloudOff size={14} />
            {pendingSync} change{pendingSync === 1 ? '' : 's'} saved on this device, waiting to sync.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="label">Title</span>
            <SavedText value={task.title} disabled={!canEdit} onSave={(v) => patch({ title: v })} />
          </label>
          <label className="block">
            <span className="label">Assignee</span>
            <Select
              value={task.assigneeId ?? ''}
              disabled={!canEdit}
              onChange={(e) => patch({ assigneeId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {s.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="label">Due</span>
            <Input
              type="date"
              value={task.dueDate ?? ''}
              disabled={!canEdit}
              onChange={(e) => patch({ dueDate: e.target.value || null })}
            />
          </label>
          <label className="block">
            <span className="label">Priority</span>
            <Select
              value={task.priority}
              disabled={!canEdit}
              onChange={(e) => patch({ priority: e.target.value as Task['priority'] })}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </Select>
          </label>
          <label className="block">
            <span className="label">Remind (days before)</span>
            <SavedText
              value={String(task.remindDaysBefore)}
              disabled={!canEdit}
              inputMode="numeric"
              onSave={(v) => patch({ remindDaysBefore: Math.max(0, Number(v) || 0) })}
            />
          </label>
          <label className="block sm:col-span-2 lg:col-span-4">
            <span className="label">Notes</span>
            <SavedText
              value={task.notes}
              disabled={!canEdit}
              multiline
              placeholder="Anything the person doing this needs to know"
              onSave={(v) => patch({ notes: v })}
            />
          </label>
        </div>

        {/* ── Recurrence ── */}
        {canEdit && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted">Repeat</h3>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block w-40">
                <span className="label">Frequency</span>
                <Select
                  value={task.recurUnit ?? ''}
                  onChange={(e) => patch({ recurUnit: (e.target.value || null) as RecurUnit | null })}
                >
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </label>

              {task.recurUnit && (
                <>
                  <label className="block w-24">
                    <span className="label">Every</span>
                    <Input
                      value={task.recurInterval}
                      inputMode="numeric"
                      onChange={(e) => patch({ recurInterval: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </label>
                  <label className="block w-56">
                    <span className="label">Counts from</span>
                    <Select
                      value={task.recurAnchor}
                      onChange={(e) => patch({ recurAnchor: e.target.value as Task['recurAnchor'] })}
                    >
                      <option value="schedule">The due date (fixed cadence)</option>
                      <option value="completion">When it's finished</option>
                    </Select>
                  </label>
                  <label className="block w-40">
                    <span className="label">Until</span>
                    <Input
                      type="date"
                      value={task.recurUntil ?? ''}
                      onChange={(e) => patch({ recurUntil: e.target.value || null })}
                    />
                  </label>
                </>
              )}
            </div>

            {task.recurUnit === 'weekly' && (
              <div className="mt-2 flex gap-1">
                {DAYS.map((d, i) => {
                  const on = task.recurWeekdays.includes(i)
                  return (
                    <button
                      key={i}
                      onClick={() =>
                        patch({
                          recurWeekdays: on
                            ? task.recurWeekdays.filter((x) => x !== i)
                            : [...task.recurWeekdays, i].sort((a, b) => a - b),
                        })
                      }
                      className={`h-9 w-9 rounded text-sm ${
 on ? 'bg-brand text-on-brand' : 'bg-overlay text-secondary'
                      }`}
                      aria-pressed={on}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            )}

            {task.recurAnchor === 'completion' && task.recurUnit && (
              <p className="mt-2 text-xs text-muted">
                The next one is scheduled from the day this is finished, so it slips if the work slips. Use the
                fixed cadence for anything that has to land on a particular day.
              </p>
            )}
          </div>
        )}

        {/* ── Steps ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted">
              {task.checklistId ? 'Checklist steps' : 'Subtasks'}
            </h3>
            {progress.fraction != null && (
              <span className="text-xs tabular-nums text-muted">
                {progress.done} of {progress.total} done
              </span>
            )}
          </div>

          {task.steps.length === 0 ? (
            <p className="text-sm text-muted">No steps yet.</p>
          ) : (
            <ul className="space-y-1">
              {task.steps.map((step) => (
                <li key={step.id} className="flex items-start gap-2 rounded px-1 py-1.5 hover:bg-overlay">
                  <button
                    className="-m-1 shrink-0 p-1 text-faint hover:text-brand"
                    aria-label={step.completedAt ? 'Un-tick' : 'Tick'}
                    // Deliberately available to the assignee even without edit
                    // rights — finishing your own work is the point.
                    disabled={!canEdit && !mine && step.assigneeId !== s.user.id}
                    onClick={() => void setStepComplete(step.id, !step.completedAt)}
                  >
                    {step.completedAt ? (
                      <CheckCircle2 size={22} className="text-brand" />
                    ) : (
                      <Circle size={22} />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={`flex items-center gap-1.5 ${step.completedAt ? 'text-faint line-through' : 'text-primary'}`}>
                      {step.assigneeId && (
                        <Avatar
                          user={s.users.find((u) => u.id === step.assigneeId) ?? {}}
                          size="xs"
                          isYou={step.assigneeId === s.user.id}
                        />
                      )}
                      {step.title}
                    </div>
                    {step.notes && <div className="text-xs text-faint">{step.notes}</div>}
                  </div>
                  {canEdit && (
                    <>
                      <Select
                        className="w-36 shrink-0"
                        value={step.assigneeId ?? ''}
                        onChange={(e) => void saveStep(step.id, { assigneeId: e.target.value || null })}
                      >
                        <option value="">Same as task</option>
                        {s.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </Select>
                      <button
                        className="shrink-0 rounded p-1 text-faint hover:text-danger"
                        onClick={() => void deleteStep(step.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!newStep.trim()) return
                void addStep(task.id, newStep.trim())
                setNewStep('')
              }}
            >
              <Input
                value={newStep}
                onChange={(e) => setNewStep(e.target.value)}
                placeholder="Add a step"
                className="flex-1"
              />
              <Button variant="ghost" type="submit" disabled={!newStep.trim()}>
                <Plus size={16} /> Add
              </Button>
            </form>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <Button
            onClick={() => void setTaskStatus(task.id, task.status === 'done' ? ('open' as TaskStatus) : 'done')}
          >
            {task.status === 'done' ? (
              <>
                <RefreshCw size={16} /> Reopen
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> Mark done
              </>
            )}
          </Button>
          <div className="flex-1" />
          {canEdit && (
            <Button
              variant="ghost"
              onClick={async () => {
                await deleteTask(task.id)
                onClose()
              }}
            >
              <Trash2 size={16} /> Delete
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
