import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * If the browser writes a table, that table must have a policy letting it.
 *
 * ── Why this is a test and not a code review ─────────────────────────────────
 *
 * A write blocked by row-level security does NOT fail loudly. An INSERT errors,
 * but an UPDATE or DELETE against a table with no matching policy simply
 * matches zero rows, and PostgREST reports that as success. The client sees no
 * error, reports "saved", and the data never changed.
 *
 * It has happened twice. `qbo_connection` is deny-all by design and the
 * QuickBooks settings screen wrote to it directly, so every mapping silently
 * reverted on reload. `field_crews` and `field_crew_members` had only a SELECT
 * policy, so removing a crew member and reassigning a crew quietly did nothing.
 * Neither produced an error anywhere.
 *
 * Both were invisible in review because the two halves live in different
 * languages and different directories. This checks them against each other.
 */
const ROOT = resolve(__dirname, '../..')
const MIG_DIR = resolve(ROOT, 'supabase/migrations')

const sql = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(resolve(MIG_DIR, f), 'utf8'))
  .join('\n')

const WRITE_CMDS = new Set(['insert', 'update', 'delete', 'all'])

/**
 * Tables that have a policy permitting a client write.
 *
 * Policies are created two ways in this schema: written out directly, and
 * generated inside a `do $$ ... end $$` loop over an array of table names.
 * Only reading the first kind would miss the loops entirely — which is how the
 * crew tables looked fine at a glance.
 */
function tablesWithWritePolicy(): Set<string> {
  const found = new Set<string>()

  for (const m of sql.matchAll(/create\s+policy\s+(?:"[^"]+"|[a-z_]+)\s+on\s+public\.([a-z_]+)\s+for\s+([a-z]+)/gi)) {
    if (WRITE_CMDS.has(m[2].toLowerCase())) found.add(m[1].toLowerCase())
  }

  for (const block of sql.matchAll(/do\s+\$\$([\s\S]*?)end\s+\$\$/gi)) {
    const body = block[1]
    // The policy NAME must be skipped explicitly, not matched loosely: these
    // are called "read for members" and "write for editors", so a lazy match up
    // to the first " for " reads the command as "members" and "editors" and
    // sees no writes anywhere.
    const cmds = [...body.matchAll(/create\s+policy\s+(?:"[^"]*"|[a-z_]+)\s+on\s+public\.%I\s+for\s+([a-z]+)/gi)].map(
      (c) => c[1].toLowerCase(),
    )
    if (!cmds.some((c) => WRITE_CMDS.has(c))) continue
    // The loop's table list, e.g. array['field_crews', 'field_crew_members'].
    for (const arr of body.matchAll(/array\s*\[([^\]]+)\]/gi)) {
      for (const name of arr[1].matchAll(/'([a-z_]+)'/gi)) found.add(name[1].toLowerCase())
    }
  }

  return found
}

/** Tables the browser writes, found by walking the client source. */
function tablesClientWrites(): Map<string, string> {
  const hits = new Map<string, string>()
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) return walk(p)
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
    })

  for (const file of walk(resolve(ROOT, 'src'))) {
    // Comments first. A doc comment explaining why we DON'T write a table
    // otherwise reads as writing it — qbo_connection is named in exactly such a
    // comment, right above the code that stopped writing it.
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const m of text.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)([\s\S]{0,240})/g)) {
      // A write is one of these called on the chain that follows .from(...).
      // Bounded lookahead: a builder chain is short, and reading further would
      // pick up the next unrelated statement.
      if (/\.(insert|update|upsert|delete)\s*\(/.test(m[2])) {
        hits.set(m[1], hits.get(m[1]) ?? file.slice(ROOT.length + 1).replace(/\\/g, '/'))
      }
    }
  }
  return hits
}

describe('client writes vs row-level security', () => {
  const allowed = tablesWithWritePolicy()
  const written = tablesClientWrites()

  it('finds both sides, so a broken parser cannot pass silently', () => {
    expect(allowed.size, 'no write policies parsed from migrations').toBeGreaterThan(5)
    expect(written.size, 'no client writes found in src/').toBeGreaterThan(5)
  })

  it('never writes a table the client has no policy for', () => {
    const offenders = [...written.entries()]
      .filter(([table]) => !allowed.has(table))
      .map(([table, file]) => `${table} (written in ${file})`)

    expect(
      offenders,
      'These are written from the browser but no RLS policy permits it. An UPDATE will match ' +
        'zero rows and report SUCCESS, so the change is lost with no error. Either add a write ' +
        'policy, or route the write through a Netlify function holding the service role.',
    ).toEqual([])
  })
})
