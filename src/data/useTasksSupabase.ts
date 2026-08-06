/**
 * The tasks slice, on Supabase, with offline support for field actions.
 *
 * ── The offline path ─────────────────────────────────────────────────────────
 *
 * `setStepComplete` and `setTaskStatus` apply OPTIMISTICALLY to local state
 * first, then try the server. If the write fails — no signal at the trailer —
 * the action goes to the outbox and is replayed when connectivity returns. The
 * screen shows the tick immediately either way, because a checkbox that doesn't
 * respond until a round trip completes is unusable on a field phone.
 *
 * Everything else (creating, assigning, editing) is online-only and returns an
 * error offline rather than queuing. See the note in `outbox.ts` for why.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SalesResult as Result, TasksSlice } from './context'
import type { Checklist, ChecklistStep, Task, TaskStatus, TaskStep } from './types'
import { supabase } from './supabaseClient'
import { type OutboxEntry, enqueue, flush, isOnline, onReconnect, pendingCount } from './outbox'
import { nextOccurrence, ruleOf } from './useTasksMock'
import { todayInTz } from '@/domain/tasks'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

// ── Mappers ────────────────────────────────────────────────────────────────

const toStep = (r: Row): TaskStep => ({
  id: r.id,
  taskId: r.task_id,
  title: r.title ?? '',
  notes: r.notes ?? '',
  sort: Number(r.sort ?? 0),
  required: r.required !== false,
  assigneeId: r.assignee_id ?? null,
  completedAt: r.completed_at ?? null,
  completedBy: r.completed_by ?? null,
  sourceStepId: r.source_step_id ?? null,
})

const toTask = (r: Row, steps: Row[]): Task => ({
  id: r.id,
  title: r.title ?? '',
  notes: r.notes ?? '',
  checklistId: r.checklist_id ?? null,
  assigneeId: r.assignee_id ?? null,
  createdBy: r.created_by ?? null,
  dueDate: r.due_date ?? null,
  priority: r.priority ?? 'normal',
  status: r.status ?? 'open',
  completedAt: r.completed_at ?? null,
  completedBy: r.completed_by ?? null,
  recurUnit: r.recur_unit ?? null,
  recurInterval: Number(r.recur_interval ?? 1),
  recurAnchor: r.recur_anchor ?? 'schedule',
  recurWeekdays: r.recur_weekdays ?? [],
  recurUntil: r.recur_until ?? null,
  recurParentId: r.recur_parent_id ?? null,
  remindDaysBefore: Number(r.remind_days_before ?? 1),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  steps: steps.filter((s) => s.task_id === r.id).map(toStep).sort((a, b) => a.sort - b.sort),
})

const toChecklistStep = (r: Row): ChecklistStep => ({
  id: r.id,
  title: r.title ?? '',
  notes: r.notes ?? '',
  sort: Number(r.sort ?? 0),
  required: r.required !== false,
})

const toChecklist = (r: Row, steps: Row[]): Checklist => ({
  id: r.id,
  name: r.name ?? '',
  description: r.description ?? '',
  category: r.category ?? '',
  active: r.active !== false,
  createdBy: r.created_by ?? null,
  steps: steps.filter((s) => s.checklist_id === r.id).map(toChecklistStep).sort((a, b) => a.sort - b.sort),
})

const taskPatchToRow = (p: Partial<Task>): Row => {
  const r: Row = {}
  const set = (k: string, v: unknown) => { if (v !== undefined) r[k] = v }
  set('title', p.title)
  set('notes', p.notes)
  set('checklist_id', p.checklistId)
  set('assignee_id', p.assigneeId)
  set('due_date', p.dueDate)
  set('priority', p.priority)
  set('status', p.status)
  set('recur_unit', p.recurUnit)
  set('recur_interval', p.recurInterval)
  set('recur_anchor', p.recurAnchor)
  set('recur_weekdays', p.recurWeekdays)
  set('recur_until', p.recurUntil)
  set('remind_days_before', p.remindDaysBefore)
  return r
}

// ── The slice ──────────────────────────────────────────────────────────────

export function useTasksSupabase(currentUserId: string | null): TasksSlice {
  const [tasks, setTasks] = useState<Task[]>([])
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [pendingSync, setPendingSync] = useState(0)
  const promiseRef = useRef<Promise<void> | null>(null)

  const refreshPending = useCallback(() => setPendingSync(pendingCount()), [])

  const loadTasks = useCallback((): Promise<void> => {
    if (promiseRef.current) return promiseRef.current
    if (!supabase) return Promise.resolve()
    setTasksLoading(true)

    const run = (async () => {
      const sb = supabase!
      const [t, ts, c, cs] = await Promise.all([
        sb.from('app_tasks').select('*').order('created_at', { ascending: false }),
        sb.from('app_task_steps').select('*'),
        sb.from('app_checklists').select('*').order('name'),
        sb.from('app_checklist_steps').select('*'),
      ])
      const err = [t, ts, c, cs].find((r) => r.error)
      if (err?.error) {
        console.error('[data] loadTasks:', err.error.message, '— has migration 0016_tasks.sql been applied?')
        promiseRef.current = null
        setTasksLoading(false)
        return
      }
      const stepRows = (ts.data as Row[]) ?? []
      const clStepRows = (cs.data as Row[]) ?? []
      setTasks(((t.data as Row[]) ?? []).map((r) => toTask(r, stepRows)))
      setChecklists(((c.data as Row[]) ?? []).map((r) => toChecklist(r, clStepRows)))
      setTasksLoading(false)
      refreshPending()
    })()

    promiseRef.current = run
    return run
  }, [refreshPending])

  /** Send one queued action. Shared by the live path and the replay. */
  const sendEntry = useCallback(async (e: OutboxEntry): Promise<{ ok: boolean; error?: string }> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (e.kind === 'step.setComplete') {
      const complete = e.payload.complete === true
      const { error } = await supabase
        .from('app_task_steps')
        .update({
          // The stamp is when the human ticked it, not when it synced — so a
          // checklist finished in the field reads correctly after a late sync.
          completed_at: complete ? e.queuedAt : null,
          completed_by: complete ? (e.payload.userId ?? null) : null,
        })
        .eq('id', e.targetId)
      return error ? { ok: false, error: error.message } : { ok: true }
    }
    if (e.kind === 'task.setStatus') {
      const { error } = await supabase
        .from('app_tasks')
        .update({
          status: e.payload.status,
          completed_at: e.payload.status === 'done' ? e.queuedAt : null,
          completed_by: e.payload.status === 'done' ? (e.payload.userId ?? null) : null,
        })
        .eq('id', e.targetId)
      return error ? { ok: false, error: error.message } : { ok: true }
    }
    return { ok: false, error: `Unknown outbox kind ${e.kind}` }
  }, [])

  /** Replay whatever is queued. Safe to call any time. */
  const sync = useCallback(async () => {
    const r = await flush(sendEntry)
    refreshPending()
    // Re-read only if something actually landed, so a no-op sync is free.
    if (r.sent > 0) {
      promiseRef.current = null
      await loadTasks()
    }
  }, [sendEntry, refreshPending, loadTasks])

  // Replay on reconnect, and once on mount in case the last session ended
  // offline with work still queued.
  useEffect(() => {
    refreshPending()
    if (isOnline() && pendingCount() > 0) void sync()
    return onReconnect(() => void sync())
  }, [sync, refreshPending])

  // ── Field actions: optimistic, queued on failure ──

  const setStepComplete = useCallback(
    async (stepId: string, complete: boolean): Promise<Result> => {
      const at = new Date().toISOString()
      setTasks((prev) =>
        prev.map((t) =>
          t.steps.some((s) => s.id === stepId)
            ? {
                ...t,
                steps: t.steps.map((s) =>
                  s.id === stepId
                    ? { ...s, completedAt: complete ? at : null, completedBy: complete ? currentUserId : null }
                    : s,
                ),
              }
            : t,
        ),
      )

      const entry: OutboxEntry = {
        id: 'live',
        kind: 'step.setComplete',
        targetId: stepId,
        payload: { complete, userId: currentUserId },
        queuedAt: at,
        attempts: 0,
      }
      if (!isOnline()) {
        enqueue('step.setComplete', stepId, { complete, userId: currentUserId })
        refreshPending()
        return { ok: true }
      }
      const r = await sendEntry(entry)
      if (!r.ok) {
        enqueue('step.setComplete', stepId, { complete, userId: currentUserId })
        refreshPending()
        // Still ok from the user's point of view — it is recorded and will sync.
        return { ok: true }
      }
      return { ok: true }
    },
    [currentUserId, sendEntry, refreshPending],
  )

  const setTaskStatus = useCallback(
    async (id: string, status: TaskStatus): Promise<Result> => {
      const at = new Date().toISOString()
      const task = tasks.find((t) => t.id === id)

      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status,
                completedAt: status === 'done' ? at : null,
                completedBy: status === 'done' ? currentUserId : null,
              }
            : t,
        ),
      )

      const payload = { status, userId: currentUserId }
      const online = isOnline()
      const r = online
        ? await sendEntry({ id: 'live', kind: 'task.setStatus', targetId: id, payload, queuedAt: at, attempts: 0 })
        : { ok: false, error: 'offline' }

      if (!r.ok) {
        enqueue('task.setStatus', id, payload)
        refreshPending()
        return { ok: true }
      }

      // Completing a recurring task creates the next one. Online only: an
      // occurrence created offline could duplicate the one the nightly tick
      // makes, and there is no way to dedupe from a phone with no connection.
      if (status === 'done' && task && ruleOf(task) && supabase) {
        const follow = nextOccurrence(task, todayInTz())
        if (follow) {
          const { data, error } = await supabase
            .from('app_tasks')
            .insert({
              ...taskPatchToRow({ ...follow, status: 'open' }),
              created_by: currentUserId,
              recur_parent_id: task.recurParentId ?? task.id,
            })
            .select()
            .single()
          if (!error && data) {
            const newId = (data as Row).id
            if (follow.steps.length) {
              await supabase.from('app_task_steps').insert(
                follow.steps.map((s, i) => ({
                  task_id: newId,
                  title: s.title,
                  notes: s.notes,
                  sort: i,
                  required: s.required,
                  source_step_id: s.sourceStepId,
                })),
              )
            }
            promiseRef.current = null
            await loadTasks()
          }
        }
      }
      return { ok: true }
    },
    [tasks, currentUserId, sendEntry, refreshPending, loadTasks],
  )

  // ── Office actions: online only ──

  const offline = (): Result => ({
    ok: false,
    error: 'You are offline. Ticking things off works offline; creating and assigning needs a connection.',
  })

  const createTask = useCallback(
    async (input: Partial<Task> & { title: string }) => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      if (!isOnline()) return offline()
      const { data, error } = await supabase
        .from('app_tasks')
        .insert({ ...taskPatchToRow(input), title: input.title, created_by: currentUserId })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }
      setTasks((prev) => [toTask(data as Row, []), ...prev])
      return { ok: true, id: (data as Row).id }
    },
    [currentUserId],
  )

  const saveTask = useCallback(async (id: string, patch: Partial<Task>): Promise<Result> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (!isOnline()) return offline()
    const { error } = await supabase.from('app_tasks').update(taskPatchToRow(patch)).eq('id', id)
    if (error) return { ok: false, error: error.message }
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    return { ok: true }
  }, [])

  const deleteTask = useCallback(async (id: string): Promise<Result> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (!isOnline()) return offline()
    const { error } = await supabase.from('app_tasks').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    setTasks((prev) => prev.filter((t) => t.id !== id))
    return { ok: true }
  }, [])

  const addStep = useCallback(async (taskId: string, title: string): Promise<Result> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (!isOnline()) return offline()
    const task = tasks.find((t) => t.id === taskId)
    const { data, error } = await supabase
      .from('app_task_steps')
      .insert({ task_id: taskId, title, sort: task?.steps.length ?? 0 })
      .select()
      .single()
    if (error) return { ok: false, error: error.message }
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, steps: [...t.steps, toStep(data as Row)] } : t)))
    return { ok: true }
  }, [tasks])

  const saveStep = useCallback(async (stepId: string, patch: Partial<TaskStep>): Promise<Result> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (!isOnline()) return offline()
    const row: Row = {}
    if (patch.title !== undefined) row.title = patch.title
    if (patch.notes !== undefined) row.notes = patch.notes
    if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId
    if (patch.sort !== undefined) row.sort = patch.sort
    const { error } = await supabase.from('app_task_steps').update(row).eq('id', stepId)
    if (error) return { ok: false, error: error.message }
    setTasks((prev) =>
      prev.map((t) => ({ ...t, steps: t.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) })),
    )
    return { ok: true }
  }, [])

  const deleteStep = useCallback(async (stepId: string): Promise<Result> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (!isOnline()) return offline()
    const { error } = await supabase.from('app_task_steps').delete().eq('id', stepId)
    if (error) return { ok: false, error: error.message }
    setTasks((prev) => prev.map((t) => ({ ...t, steps: t.steps.filter((s) => s.id !== stepId) })))
    return { ok: true }
  }, [])

  const createChecklist = useCallback(
    async (input: Partial<Checklist> & { name: string }) => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      if (!isOnline()) return offline()
      const { data, error } = await supabase
        .from('app_checklists')
        .insert({
          name: input.name,
          description: input.description ?? '',
          category: input.category ?? '',
          created_by: currentUserId,
        })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }
      setChecklists((prev) => [toChecklist(data as Row, []), ...prev])
      return { ok: true, id: (data as Row).id }
    },
    [currentUserId],
  )

  const saveChecklist = useCallback(async (id: string, patch: Partial<Checklist>): Promise<Result> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (!isOnline()) return offline()
    const row: Row = {}
    if (patch.name !== undefined) row.name = patch.name
    if (patch.description !== undefined) row.description = patch.description
    if (patch.category !== undefined) row.category = patch.category
    if (patch.active !== undefined) row.active = patch.active
    if (Object.keys(row).length) {
      const { error } = await supabase.from('app_checklists').update(row).eq('id', id)
      if (error) return { ok: false, error: error.message }
    }
    // Steps replace wholesale — a template is short and edited as a whole.
    if (patch.steps) {
      await supabase.from('app_checklist_steps').delete().eq('checklist_id', id)
      if (patch.steps.length) {
        const { error } = await supabase.from('app_checklist_steps').insert(
          patch.steps.map((s, i) => ({
            checklist_id: id,
            title: s.title,
            notes: s.notes,
            sort: i,
            required: s.required,
          })),
        )
        if (error) return { ok: false, error: error.message }
      }
    }
    setChecklists((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    return { ok: true }
  }, [])

  const deleteChecklist = useCallback(async (id: string): Promise<Result> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    if (!isOnline()) return offline()
    const { error } = await supabase.from('app_checklists').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    setChecklists((prev) => prev.filter((c) => c.id !== id))
    return { ok: true }
  }, [])

  const assignChecklist = useCallback(
    async (input: { checklistId: string; assigneeId: string | null; dueDate?: string | null; title?: string }) => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      if (!isOnline()) return offline()
      const cl = checklists.find((c) => c.id === input.checklistId)
      if (!cl) return { ok: false, error: 'Checklist not found' }

      const { data, error } = await supabase
        .from('app_tasks')
        .insert({
          title: input.title || cl.name,
          notes: cl.description,
          checklist_id: cl.id,
          assignee_id: input.assigneeId,
          due_date: input.dueDate ?? null,
          created_by: currentUserId,
        })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }
      const taskId = (data as Row).id

      // Steps are COPIED. Editing the template later must not rewrite a run
      // somebody is partway through.
      if (cl.steps.length) {
        const { error: se } = await supabase.from('app_task_steps').insert(
          [...cl.steps]
            .sort((a, b) => a.sort - b.sort)
            .map((s, i) => ({
              task_id: taskId,
              title: s.title,
              notes: s.notes,
              sort: i,
              required: s.required,
              source_step_id: s.id,
            })),
        )
        if (se) return { ok: false, error: se.message }
      }

      promiseRef.current = null
      await loadTasks()
      return { ok: true, id: taskId }
    },
    [checklists, currentUserId, loadTasks],
  )

  return useMemo<TasksSlice>(
    () => ({
      tasks,
      checklists,
      tasksLoading,
      loadTasks,
      pendingSync,
      createTask,
      saveTask,
      deleteTask,
      setTaskStatus,
      addStep,
      saveStep,
      setStepComplete,
      deleteStep,
      createChecklist,
      saveChecklist,
      deleteChecklist,
      assignChecklist,
    }),
    [
      tasks, checklists, tasksLoading, loadTasks, pendingSync, createTask, saveTask, deleteTask,
      setTaskStatus, addStep, saveStep, setStepComplete, deleteStep, createChecklist, saveChecklist,
      deleteChecklist, assignChecklist,
    ],
  )
}
