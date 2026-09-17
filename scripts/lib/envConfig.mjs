/**
 * Where a script's secret came from — said out loud, in one place.
 *
 * Both operator scripts (`run-sql.mjs`, `push-email-templates.mjs`) resolve
 * `SUPABASE_ACCESS_TOKEN` the same way: environment first, then `.env.local`.
 * That precedence is ordinary and worth keeping. Doing it SILENTLY is what
 * cost a session.
 *
 * What happened, because the comment is the whole justification for this file:
 * a stale token sat in the Windows USER environment and shadowed a good one in
 * `.env.local`. Every run failed with "your account does not have the
 * necessary privileges" — a message that points at the account, at Supabase,
 * at the org role, at anything except the two-line lookup that picked the
 * wrong string. Editing `.env.local` changed nothing, because `.env.local` was
 * never being read. Underneath that sat a SECOND shadow: the file defined the
 * key twice and the reader returned the first match, which was truncated.
 *
 * Two shadows, no output. So: name the source on every run, and make a
 * conflict loud. The fix living in only one of the two scripts is how the
 * next person meets the same hour.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Mask a secret down to something identifiable but useless. */
export function fingerprint(value) {
  if (!value) return 'none'
  return `…${value.slice(-6)} (${value.length} chars)`
}

/**
 * Every value `.env.local` gives for `key`, in file order.
 *
 * Returns ALL of them, not the first, so the caller can see a duplicate rather
 * than silently inheriting one. Missing file is an empty list, not an error —
 * these scripts run fine on a real environment variable alone.
 */
export function readEnvFileValues(root, key) {
  const path = join(root, '.env.local')
  if (!existsSync(path)) return []
  const found = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m && m[1] === key) found.push(m[2].trim().replace(/^["']|["']$/g, ''))
  }
  return found
}

/**
 * Decide which value wins, and what the operator needs told about it.
 *
 * Pure on purpose — no fs, no console, no process — so the decision can be
 * tested without a filesystem. `resolveSecret` is the thin shell that does IO.
 *
 * `notices` are for the operator, not for logs: a `warn` means the run may be
 * about to fail for a reason that will not look like this one.
 */
export function chooseSecret({ name, fromEnv = null, fileValues = [] }) {
  const notices = []
  const fromFile = fileValues[0] ?? null

  // A repeated key is not a style problem. The first wins, so a later line is
  // dead — and a truncated first line reads as a bad secret rather than as a
  // shadowed good one.
  if (fileValues.length > 1 && new Set(fileValues).size > 1) {
    notices.push({
      level: 'warn',
      text:
        `.env.local defines ${name} ${fileValues.length} times with different values.\n` +
        `  Using the first (${fingerprint(fromFile)}). The others are dead — delete them.`,
    })
  }

  if (fromEnv && fromFile && fromEnv !== fromFile) {
    notices.push({
      level: 'warn',
      text:
        `Two different values for ${name}.\n` +
        `    environment: ${fingerprint(fromEnv)}   <- being used\n` +
        `    .env.local:  ${fingerprint(fromFile)}   <- ignored\n` +
        `  The environment wins. If this run fails on permissions, that is why.\n` +
        `  One run:  env -u ${name} node scripts/<script>.mjs …\n` +
        `  For good: [Environment]::SetEnvironmentVariable('${name}', $null, 'User')`,
    })
  } else if (fromEnv) {
    notices.push({ level: 'info', text: `${name}: environment ${fingerprint(fromEnv)}` })
  } else if (fromFile) {
    notices.push({ level: 'info', text: `${name}: .env.local ${fingerprint(fromFile)}` })
  }

  return {
    value: fromEnv ?? fromFile,
    source: fromEnv ? 'environment' : fromFile ? '.env.local' : null,
    notices,
  }
}

/**
 * `chooseSecret` with the filesystem and the console attached.
 *
 * `announce: false` suppresses the routine "here is where it came from" line
 * for values nobody needs narrated (a project ref), while still printing a
 * conflict — a warning is never routine.
 */
export function resolveSecret(root, name, { announce = true } = {}) {
  const result = chooseSecret({
    name,
    fromEnv: process.env[name] || null,
    fileValues: readEnvFileValues(root, name),
  })
  for (const n of result.notices) {
    if (n.level === 'warn') console.warn(`\n⚠ ${n.text}\n`)
    else if (announce) console.log(n.text)
  }
  return result.value
}
