/**
 * The tasks slice, on in-memory mock data. Pairs with `useTasksSupabase`.
 *
 * Mirrors the server behaviour that matters: completing a recurring task
 * spawns its next occurrence, assigning a checklist copies the template's steps
 * into a run, and `status`/`completedAt` are kept in step (migration 0016 has a
 * trigger for that; here it's done in `applyCompletion`).
 */
import { useCallback, useMemo, useState } from 'react'
import type { SalesResult as Result, TasksSlice } from './context'
import type { Checklist, Task, TaskStatus, TaskStep } from './types'
import { type RecurRule, nextDueDate, todayInTz } from '@/domain/tasks'
import { SEED_CHECKLISTS, SEED_TASKS } from './tasksSeed'

let n = 0
const nextId = (p: string) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`
const nowIso = () => new Date().toISOString()

/** The recurrence rule on a task, or null when it doesn't repeat. */
export function ruleOf(t: Task): RecurRule | null {
  if (!t.recurUnit) return null
  return {
    unit: t.recurUnit,
    interval: t.recurInterval,
    anchor: t.recurAnchor,
    weekdays: t.recurWeekdays,
    until: t.recurUntil,
  }
}

/**
 * Keep `status` and `completedAt` consistent — the mock's copy of the DB
 * trigger. Reopening clears the stamp so a task can't claim it was finished.
 */
export function applyCompletion(t: Task, status: TaskStatus, userId: string | null): Task {
  if (status === 'done') {
    return { ...t, status, completedAt: t.completedAt ?? nowIso(), completedBy: userId, updatedAt: nowIso() }
  }
  return { ...t, status, completedAt: null, completedBy: null, updatedAt: nowIso() }
}

/**
 * The next occurrence of a recurring task, or null if it doesn't recur or the
 * rule has run out.
 *
 * The anchor decides what the next due date counts from: the last DUE date for
 * a schedule-anchored rule, the completion date for a completion-anchored one.
 */
export function nextOccurrence(t: Task, completedOn = todayInTz()): Task | null {
  const rule = ruleOf(t)
  if (!rule) return null
  const from = rule.anchor === 'completion' ? completedOn : (t.dueDate ?? completedOn)
  const due = nextDueDate(rule, from)
  if (!due) return null

  return {
    ...t,
    id: nextId('task'),
    dueDate: due,
    status: 'open',
    completedAt: null,
    completedBy: null,
    // Point at the head of the series, not the immediately previous instance,
    // so a long-running series stays one flat generation deep.
    recurParentId: t.recurParentId ?? t.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    steps: t.steps.map((s) => ({ ...s, id: nextId('st'), completedAt: null, completedBy: null })),
  }
}

export function useTasksMock(currentUserId: string | null): TasksSlice {
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS)
  const [checklists, setChecklists] = useState<Checklist[]>(SEED_CHECKLISTS)

  const createTask = useCallback(
    async (input: Partial<Task> & { title: string }) => {
      const id = nextId('task')
      setTasks((prev) => [
        {
          notes: '',
          checklistId: null,
          assigneeId: null,
          createdBy: currentUserId,
          dueDate: null,
          priority: 'normal',
          status: 'open',
          completedAt: null,
          completedBy: null,
          recurUnit: null,
          recurInterval: 1,
          recurAnchor: 'schedule',
          recurWeekdays: [],
          recurUntil: null,
          recurParentId: null,
          remindDaysBefore: 1,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          steps: [],
          ...input,
          id,
        },
        ...prev,
      ])
      return { ok: true, id }
    },
    [currentUserId],
  )

  const saveTask = useCallback(async (id: string, patch: Partial<Task>): Promise<Result> => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: nowIso() } : t)))
    return { ok: true }
  }, [])

  const deleteTask = useCallback(async (id: string): Promise<Result> => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    return { ok: true }
  }, [])

  const setTaskStatus = useCallback(
    async (id: string, status: TaskStatus): Promise<Result> => {
      setTasks((prev) => {
        const t = prev.find((x) => x.id === id)
        if (!t) return prev
        const updated = applyCompletion(t, status, currentUserId)
        const next = prev.map((x) => (x.id === id ? updated : x))

        // Completing a recurring task is what creates the next one. A
        // schedule-anchored task also gets materialized by the nightly tick;
        // doing it here too means the crew sees it immediately rather than
        // tomorrow, and the tick dedupes on (parent, due date).
        if (status === 'done') {
          const follow = nextOccurrence(updated)
          if (follow) return [follow, ...next]
        }
        return next
      })
      return { ok: true }
    },
    [currentUserId],
  )

  const setStepComplete = useCallback(
    async (stepId: string, complete: boolean): Promise<Result> => {
      setTasks((prev) =>
        prev.map((t) =>
          t.steps.some((s) => s.id === stepId)
            ? {
                ...t,
                steps: t.steps.map((s) =>
                  s.id === stepId
                    ? { ...s, completedAt: complete ? nowIso() : null, completedBy: complete ? currentUserId : null }
                    : s,
                ),
                updatedAt: nowIso(),
              }
            : t,
        ),
      )
      return { ok: true }
    },
    [currentUserId],
  )

  const saveStep = useCallback(async (stepId: string, patch: Partial<TaskStep>): Promise<Result> => {
    setTasks((prev) =>
      prev.map((t) => ({ ...t, steps: t.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) })),
    )
    return { ok: true }
  }, [])

  const addStep = useCallback(async (taskId: string, title: string): Promise<Result> => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: [
                ...t.steps,
                {
                  id: nextId('st'),
                  taskId,
                  title,
                  notes: '',
                  sort: t.steps.length,
                  required: true,
                  assigneeId: null,
                  completedAt: null,
                  completedBy: null,
                  sourceStepId: null,
                },
              ],
            }
          : t,
      ),
    )
    return { ok: true }
  }, [])

  const deleteStep = useCallback(async (stepId: string): Promise<Result> => {
    setTasks((prev) => prev.map((t) => ({ ...t, steps: t.steps.filter((s) => s.id !== stepId) })))
    return { ok: true }
  }, [])

  const saveChecklist = useCallback(async (id: string, patch: Partial<Checklist>): Promise<Result> => {
    setChecklists((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    return { ok: true }
  }, [])

  const createChecklist = useCallback(
    async (input: Partial<Checklist> & { name: string }) => {
      const id = nextId('cl')
      setChecklists((prev) => [
        {
          description: '',
          category: '',
          active: true,
          createdBy: currentUserId,
          steps: [],
          ...input,
          id,
        },
        ...prev,
      ])
      return { ok: true, id }
    },
    [currentUserId],
  )

  const deleteChecklist = useCallback(async (id: string): Promise<Result> => {
    setChecklists((prev) => prev.filter((c) => c.id !== id))
    return { ok: true }
  }, [])

  const assignChecklist = useCallback(
    async (input: { checklistId: string; assigneeId: string | null; dueDate?: string | null; title?: string }) => {
      const cl = checklists.find((c) => c.id === input.checklistId)
      if (!cl) return { ok: false, error: 'Checklist not found' }

      const id = nextId('task')
      // Steps are COPIED, not referenced. Editing the template afterwards must
      // not rewrite a run somebody is partway through.
      const steps: TaskStep[] = [...cl.steps]
        .sort((a, b) => a.sort - b.sort)
        .map((s, i) => ({
          id: nextId('st'),
          taskId: id,
          title: s.title,
          notes: s.notes,
          sort: i,
          required: s.required,
          assigneeId: null,
          completedAt: null,
          completedBy: null,
          sourceStepId: s.id,
        }))

      setTasks((prev) => [
        {
          id,
          title: input.title || cl.name,
          notes: cl.description,
          checklistId: cl.id,
          assigneeId: input.assigneeId,
          createdBy: currentUserId,
          dueDate: input.dueDate ?? null,
          priority: 'normal',
          status: 'open',
          completedAt: null,
          completedBy: null,
          recurUnit: null,
          recurInterval: 1,
          recurAnchor: 'schedule',
          recurWeekdays: [],
          recurUntil: null,
          recurParentId: null,
          remindDaysBefore: 1,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          steps,
        },
        ...prev,
      ])
      return { ok: true, id }
    },
    [checklists, currentUserId],
  )

  return useMemo<TasksSlice>(
    () => ({
      tasks,
      checklists,
      tasksLoading: false,
      loadTasks: async () => {},
      pendingSync: 0,
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
      tasks, checklists, createTask, saveTask, deleteTask, setTaskStatus, addStep, saveStep,
      setStepComplete, deleteStep, createChecklist, saveChecklist, deleteChecklist, assignChecklist,
    ],
  )
}
