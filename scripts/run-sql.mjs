#!/usr/bin/env node
/**
 * Run a .sql file against the live Supabase database.
 *
 * Migrations in this project have always been pasted into the dashboard's SQL
 * editor by hand — there is no CLI and no psql here. That is fine for one
 * statement and miserable for a migration plus a 191-row import, so this uses
 * the Management API's query endpoint: the same door the dashboard editor uses,
 * with the same personal access token `email:push` already needs.
 *
 *   node scripts/run-sql.mjs supabase/migrations/0039_field_checklist.sql
 *   node scripts/run-sql.mjs --dry-run path/to/file.sql        # print, send nothing
 *   node scripts/run-sql.mjs --query "select count(*) from public.field_checklist"
 *
 * ── The token ────────────────────────────────────────────────────────────────
 *
 * `SUPABASE_ACCESS_TOKEN` in `.env.local` (gitignored). It is account-wide, not
 * project-scoped, and this endpoint executes arbitrary SQL as an owner — so
 * read what you are about to run. It refuses obviously destructive statements
 * below; that guard is a seatbelt, not a permission system.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_REF = 'pmqbkezevsuwkoryxief' // the shared project; see CLAUDE.md

/** Statements this script will not send. Say them out loud in the dashboard. */
const REFUSE = [
  /\bdrop\s+(table|schema|database)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b(?![^;]*\bwhere\b)/i,
  /\bdrop\s+column\b/i,
]

function fromEnvFile(key) {
  const path = join(ROOT, '.env.local')
  if (!existsSync(path)) return null
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const qIndex = argv.indexOf('--query')
const inlineQuery = qIndex >= 0 ? argv[qIndex + 1] : null
const files = argv.filter((a) => !a.startsWith('--') && a !== inlineQuery)

const ref = process.env.SUPABASE_PROJECT_REF || fromEnvFile('SUPABASE_PROJECT_REF') || DEFAULT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN || fromEnvFile('SUPABASE_ACCESS_TOKEN')

if (!inlineQuery && files.length === 0) die('Nothing to run. Pass a .sql file, or --query "select …".')
if (!token && !dryRun) {
  die(
    'No SUPABASE_ACCESS_TOKEN.\n' +
      '  Create one at https://supabase.com/dashboard/account/tokens,\n' +
      '  then add to .env.local:  SUPABASE_ACCESS_TOKEN=sbp_...',
  )
}

async function run(label, sql) {
  for (const pattern of REFUSE) {
    if (pattern.test(sql)) die(`${label} contains ${pattern} — run that one in the dashboard, deliberately.`)
  }
  console.log(`\n▸ ${label} (${sql.length.toLocaleString()} chars)`)
  if (dryRun) {
    console.log(sql.slice(0, 400) + (sql.length > 400 ? '\n  …' : ''))
    return
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) {
    if (res.status === 401) die('Supabase rejected the token (401) — expired or revoked.')
    die(`${label} failed (${res.status}): ${text.slice(0, 500)}`)
  }
  let out
  try {
    out = JSON.parse(text)
  } catch {
    out = text
  }
  console.log('  ✓ ok', Array.isArray(out) && out.length ? JSON.stringify(out).slice(0, 400) : '')
}

if (inlineQuery) await run('--query', inlineQuery)
for (const f of files) {
  const path = join(ROOT, f)
  if (!existsSync(path)) die(`no such file: ${f}`)
  await run(f, readFileSync(path, 'utf8'))
}
console.log(dryRun ? '\n--dry-run: nothing sent.' : '\nDone.')
