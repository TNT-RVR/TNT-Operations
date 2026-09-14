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
 * (see `lib/sqlGuards.mjs`); that guard is a seatbelt, not a permission system.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refusalFor } from './lib/sqlGuards.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_REF = 'pmqbkezevsuwkoryxief' // the shared project; see CLAUDE.md

function fromEnvFile(key) {
  const path = join(ROOT, '.env.local')
  if (!existsSync(path)) return null
  const found = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m && m[1] === key) found.push(m[2].trim().replace(/^["']|["']$/g, ''))
  }
  // A repeated key is not a style problem. The first one wins, so a second
  // line is dead — and a TRUNCATED first line looks exactly like a bad token
  // rather than like a shadowed good one.
  if (found.length > 1 && new Set(found).size > 1) {
    console.warn(`⚠ .env.local defines ${key} ${found.length} times with different values; using the first.`)
  }
  return found[0] ?? null
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
const token = resolveToken()

/**
 * Pick the token, and SAY WHERE IT CAME FROM.
 *
 * The environment still wins over the file — that is the ordinary convention
 * and worth keeping. What is not survivable is doing it silently. A stale
 * `SUPABASE_ACCESS_TOKEN` left in the Windows USER environment shadowed a
 * perfectly good one in `.env.local`, and every run failed with "your account
 * does not have the necessary privileges" — which points at the account, at
 * Supabase, at anything except the two-line lookup that chose the wrong
 * string. Editing `.env.local` changed nothing, because `.env.local` was
 * never being read.
 */
function resolveToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN || null
  const fromFile = fromEnvFile('SUPABASE_ACCESS_TOKEN')
  const tail = (t) => (t ? `…${t.slice(-6)} (${t.length} chars)` : 'none')

  if (fromEnv && fromFile && fromEnv !== fromFile) {
    console.warn(
      `\n⚠ Two different SUPABASE_ACCESS_TOKENs.\n` +
        `    environment: ${tail(fromEnv)}   <- being used\n` +
        `    .env.local:  ${tail(fromFile)}   <- ignored\n` +
        `  The environment wins. If this run fails on permissions, that is why.\n` +
        `  One run:  env -u SUPABASE_ACCESS_TOKEN node scripts/run-sql.mjs …\n` +
        `  For good: [Environment]::SetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', $null, 'User')\n`,
    )
  } else if (fromEnv) {
    console.log(`token: environment ${tail(fromEnv)}`)
  } else if (fromFile) {
    console.log(`token: .env.local ${tail(fromFile)}`)
  }
  return fromEnv || fromFile
}

if (!inlineQuery && files.length === 0) die('Nothing to run. Pass a .sql file, or --query "select …".')
if (!token && !dryRun) {
  die(
    'No SUPABASE_ACCESS_TOKEN.\n' +
      '  Create one at https://supabase.com/dashboard/account/tokens,\n' +
      '  then add to .env.local:  SUPABASE_ACCESS_TOKEN=sbp_...',
  )
}

async function run(label, sql) {
  const refusal = refusalFor(sql)
  if (refusal) die(`${label} contains ${refusal.why}. Run that one in the dashboard, deliberately.`)
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
