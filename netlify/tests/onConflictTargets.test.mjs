import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Every `on_conflict=` column set must have a usable arbiter in the schema.
 *
 * PostgREST turns `?on_conflict=a,b` into a bare `ON CONFLICT (a, b)`, and
 * Postgres accepts that only if a PRIMARY KEY, a UNIQUE constraint, or a
 * NON-PARTIAL unique index covers exactly those columns. A partial index — one
 * carrying a `where` clause — is silently not a candidate: the statement would
 * have to repeat the same predicate, which PostgREST never does.
 *
 * It fails as 42P10 at runtime, inside a scheduled function, long after the
 * migration looked fine. `bee_purchases` shipped with
 * `(qbo_id) where qbo_id is not null` and could read QuickBooks perfectly while
 * storing nothing.
 *
 * ── The vacuous-pass trap ────────────────────────────────────────────────────
 *
 * The first version of this file passed while checking NOTHING: a broken
 * regex left the candidate list empty, so `expect(broken).toEqual([])` was
 * trivially true. Counting inputs is not enough — the assertions below check
 * that the set actually reaching the arbiter test is non-empty, and that the
 * detector says yes to a known-good table. A test that cannot fail is worse
 * than no test, because it is mistaken for cover.
 */
const FN_DIR = resolve(__dirname, '../functions')
const MIG_DIR = resolve(__dirname, '../../supabase/migrations')

const sql = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(resolve(MIG_DIR, f), 'utf8'))
  .join('\n')

const asSet = (cols) =>
  cols
    .split(',')
    .map((c) => c.trim())
    .sort()
    .join(',')

/** `table -> [columns]` for every upsert the functions perform. */
function upsertTargets() {
  const out = []
  for (const f of readdirSync(FN_DIR).filter((n) => /\.mjs$/.test(n) && !/\.test\./.test(n))) {
    const text = readFileSync(resolve(FN_DIR, f), 'utf8')
    for (const m of text.matchAll(/([a-z_]+)\?on_conflict=([a-z_,]+)/gi)) {
      out.push({ file: f, table: m[1], cols: m[2] })
    }
  }
  return out
}

/** Does this repo's schema define the table at all? */
function schemaOwns(table) {
  return new RegExp(`public\\.${table}[\\s(;]`).test(sql)
}

/**
 * Is there an arbiter for these columns?
 *
 * Column ORDER does not matter to Postgres for inference, so everything is
 * compared as a sorted set. A `where` clause disqualifies an index outright —
 * that is the whole point.
 */
function hasArbiter(table, cols) {
  const want = asSet(cols)

  const createTable = new RegExp(
    `create table[^;]*?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
    'i',
  ).exec(sql)

  if (createTable) {
    const body = createTable[1]
    for (const line of body.split('\n')) {
      // Inline single-column: `realm_id text primary key`.
      const inline = /^\s*([a-z_]+)\s+[a-z0-9_ ()]*?\b(primary key|unique)\b/i.exec(line)
      if (inline && inline[1] === want) return true
    }
    // Table-level: `unique (a, b)` / `primary key (a, b)`.
    for (const m of body.matchAll(/\b(?:unique|primary key)\s*\(([^)]+)\)/gi)) {
      if (asSet(m[1]) === want) return true
    }
  }

  // Standalone unique index — rejected if it carries a predicate.
  for (const m of sql.matchAll(
    new RegExp(`create unique index[^;]*?\\son\\s+public\\.${table}\\s*\\(([^)]+)\\)([^;]*);`, 'gi'),
  )) {
    if (/\bwhere\b/i.test(m[2])) continue
    if (asSet(m[1]) === want) return true
  }

  // `alter table ... add constraint ... unique (a, b)`.
  for (const m of sql.matchAll(
    new RegExp(`alter table[^;]*?public\\.${table}\\b[^;]*?\\bunique\\s*\\(([^)]+)\\)`, 'gi'),
  )) {
    if (asSet(m[1]) === want) return true
  }

  return false
}

describe('on_conflict targets have a usable arbiter', () => {
  const targets = upsertTargets()
  const owned = targets.filter((t) => schemaOwns(t.table))

  it('actually examines something — a vacuous pass is the failure mode here', () => {
    expect(targets.length, 'no upserts found in netlify/functions').toBeGreaterThan(3)
    expect(owned.length, 'no upsert target is defined in supabase/migrations').toBeGreaterThan(2)
  })

  it('the detector recognises a known-good arbiter', () => {
    // qbo_connection's realm_id is an inline primary key. If this says no, the
    // detector is broken and every other result here is meaningless.
    expect(hasArbiter('qbo_connection', 'realm_id')).toBe(true)
  })

  it('the detector REJECTS a partial index', () => {
    // The bug this file exists for. bee_purchases must be arbitrated by the
    // full index from 0036, never by 0035's `where qbo_id is not null`.
    const partialOnly = /create unique index[^;]*?bee_purchases[^;]*?where[^;]*;/i.test(sql)
    const fullExists = /create unique index[^;]*?on\s+public\.bee_purchases\s*\(\s*qbo_id\s*\)\s*;/i.test(sql)
    expect(partialOnly, 'expected 0035 to still carry its partial index').toBe(true)
    expect(fullExists, 'expected 0036 to add a non-partial unique index').toBe(true)
  })

  it('every upsert can resolve its conflict target', () => {
    const broken = owned
      .filter((t) => !hasArbiter(t.table, t.cols))
      .map((t) => `${t.table} (${t.cols}) from ${t.file}`)

    expect(
      broken,
      'PostgREST emits a bare ON CONFLICT (cols). That needs a primary key, a unique constraint, or a ' +
        'NON-PARTIAL unique index on exactly those columns. A partial index (one with a WHERE) is not a ' +
        'candidate and fails at runtime with 42P10.',
    ).toEqual([])
  })
})
