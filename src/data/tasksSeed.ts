/**
 * Mock seed for tasks — the same "Field prep — shelter build" checklist that
 * migration 0016 seeds, plus a few tasks that exercise the states worth seeing
 * on a first run: overdue, recurring, and a checklist run in progress.
 */
import type { Checklist, Task, TaskStep } from './types'
import { addDays, todayInTz } from '@/domain/tasks'

const TODAY = todayInTz()
const rel = (n: number) => addDays(TODAY, n)!

const FIELD_PREP_STEPS = [
  ['Confirm field and access route', 'Check the map for the gate, access road and any wet zones.'],
  ['Print or load the shelter map', 'Pin positions and crew route for the field.'],
  ['Load coroplast sheets', '2 per shelter.'],
  ['Load pallets', '1 per shelter.'],
  ['Load anchors', '1 per shelter.'],
  ['Load zip ties', '4 per shelter, plus spares.'],
  ['Load bungees', '2 per shelter, plus spares.'],
  ['Load vinyl straps', '2 per shelter.'],
  ['Load rivets (1/2 in and 3/4 in)', '6 and 14 per shelter.'],
  ['Rivet gun + spare mandrels', ''],
  ['Cordless drill + charged batteries', ''],
  ['Tape measure and marking flags', ''],
  ['Water and first aid kit', ''],
  ['Fuel up the truck', ''],
  ['Charge the tablet for Field Mode', 'GPS shelter placement runs off it.'],
  ['Check the weather', 'Wind decides whether shelters can be stood up at all.'],
] as const

export const SEED_CHECKLISTS: Checklist[] = [
  {
    id: 'cl_field_prep',
    name: 'Field prep — shelter build',
    description: 'Everything that has to be loaded and checked before a crew leaves to build shelters on a field.',
    category: 'Field',
    active: true,
    createdBy: null,
    steps: FIELD_PREP_STEPS.map(([title, notes], i) => ({
      id: `cls_fp_${i}`,
      title,
      notes,
      sort: i + 1,
      required: true,
    })),
  },
  {
    id: 'cl_incubator_start',
    name: 'Incubator start-up',
    description: 'Bringing an incubator online at the start of a run.',
    category: 'Incubation',
    active: true,
    createdBy: null,
    steps: [
      ['Clean and disinfect the chamber', ''],
      ['Check heat pumps and fans', 'Both must cycle.'],
      ['Verify the Govee sensor is reporting', 'Check the live reading on the incubator.'],
      ['Calibrate against the reference thermometer', 'Log the difference on the inspection.'],
      ['Set the target temperature and band', ''],
      ['Load trays and record positions', ''],
      ['Log the start inspection', ''],
    ].map(([title, notes], i) => ({ id: `cls_is_${i}`, title, notes, sort: i + 1, required: true })),
  },
]

const step = (taskId: string, i: number, title: string, done = false): TaskStep => ({
  id: `st_${taskId}_${i}`,
  taskId,
  title,
  notes: '',
  sort: i,
  required: true,
  assigneeId: null,
  completedAt: done ? new Date().toISOString() : null,
  completedBy: null,
  sourceStepId: null,
})

const base = {
  notes: '',
  checklistId: null,
  createdBy: 'u_admin',
  priority: 'normal' as const,
  status: 'open' as const,
  completedAt: null,
  completedBy: null,
  recurUnit: null,
  recurInterval: 1,
  recurAnchor: 'schedule' as const,
  recurWeekdays: [],
  recurUntil: null,
  recurParentId: null,
  remindDaysBefore: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export const SEED_TASKS: Task[] = [
  {
    ...base,
    id: 'task_1',
    title: 'Get HS codes from the broker for trays and shelters',
    notes: 'Blocking every customs document until this lands.',
    assigneeId: 'u_admin',
    dueDate: rel(-3), // overdue
    priority: 'high',
    steps: [
      step('task_1', 0, 'Email the broker the product list', true),
      step('task_1', 1, 'Enter codes on each product'),
    ],
  },
  {
    ...base,
    id: 'task_2',
    title: 'Weigh corners, zip ties, bungees and nesting blocks',
    notes: 'No shipping specs on file, so freight quotes understate them.',
    assigneeId: 'u_op',
    dueDate: rel(2),
    steps: [],
  },
  {
    ...base,
    id: 'task_3',
    title: 'Weekly incubator walk-through',
    assigneeId: 'u_op',
    dueDate: rel(1),
    recurUnit: 'weekly',
    recurWeekdays: [1],
    steps: [],
  },
  {
    ...base,
    id: 'task_4',
    title: 'Service the generator',
    notes: 'Counts 90 days from the last service, not from a fixed calendar date.',
    assigneeId: null,
    dueDate: rel(30),
    recurUnit: 'daily',
    recurInterval: 90,
    recurAnchor: 'completion',
    steps: [],
  },
  {
    ...base,
    id: 'task_5',
    title: 'Field prep — shelter build (Wordmans)',
    notes: 'Everything that has to be loaded and checked before a crew leaves.',
    checklistId: 'cl_field_prep',
    assigneeId: 'u_dev',
    dueDate: rel(1),
    steps: FIELD_PREP_STEPS.map(([title], i) => step('task_5', i, title, i < 5)),
  },
]
