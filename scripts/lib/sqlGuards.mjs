/**
 * The seatbelt `run-sql.mjs` wears: statements it will not send unattended.
 *
 * This is a guard, NOT a permission system. The Management API token is
 * account-wide and executes as an owner, so anything refused here can still be
 * run — deliberately, in the dashboard, having read it. The point is that the
 * irreversible ones should cost a decision rather than a keystroke.
 *
 * It lives in its own file so it can be tested. A regex guard is exactly the
 * thing that quietly stops matching, and the failure is silent in the direction
 * that matters: a pattern that no longer fires looks identical to a migration
 * that was safe.
 */

/**
 * Remove comments and string bodies, leaving the executable shape of the SQL.
 *
 * The guards used to run against the raw file, which is wrong in BOTH
 * directions for this repo. Migrations here carry long explanatory headers, and
 * a comment reading "a tray that moves must update trays set incubator_id"
 * would be refused as though it were a statement — and a guard that blocks
 * legitimate work is one that gets commented out, which costs more than it ever
 * saved. In the other direction a literal `'drop table'` inside a string was
 * enough to trip it.
 *
 * Postgres specifics that matter here: block comments NEST, single quotes are
 * escaped by doubling, and function bodies are dollar-quoted with a tag
 * ($$ … $$ or $fn$ … $fn$) which this repo uses for every SECURITY DEFINER
 * trigger. Dollar-quoted bodies are blanked too: a trigger's own UPDATE is not
 * the thing being run right now, and reading it as one refuses most of this
 * project's migrations.
 *
 * Whitespace replaces whatever is removed, so nothing accidentally joins up
 * into a keyword that was never written.
 */
export function stripSqlComments(sql) {
  let out = ''
  let i = 0
  const blank = (n) => ' '.repeat(n)

  while (i < sql.length) {
    const two = sql.slice(i, i + 2)

    if (two === '--') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      out += blank(stop - i)
      i = stop
      continue
    }

    if (two === '/*') {
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql.slice(j, j + 2) === '/*') {
          depth++
          j += 2
        } else if (sql.slice(j, j + 2) === '*/') {
          depth--
          j += 2
        } else j++
      }
      out += blank(j - i)
      i = j
      continue
    }

    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") {
          j++
          break
        } else j++
      }
      // Keep the quotes so the statement still parses as having a value there.
      out += "''" + blank(j - i - 2)
      i = j
      continue
    }

    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
    if (dollar) {
      const tag = dollar[0]
      const end = sql.indexOf(tag, i + tag.length)
      const stop = end === -1 ? sql.length : end + tag.length
      out += blank(stop - i)
      i = stop
      continue
    }

    out += sql[i]
    i++
  }
  return out
}

/**
 * Each guard says what it catches and why the answer is "go do it by hand".
 */
export const REFUSE = [
  {
    pattern: /\bdrop\s+(table|schema|database)\b/i,
    why: 'dropping a table, schema or database',
  },
  { pattern: /\btruncate\b/i, why: 'truncating a table' },
  {
    pattern: /\bdelete\s+from\b(?![^;]*\bwhere\b)/i,
    why: 'a DELETE with no WHERE — that is every row',
  },
  { pattern: /\bdrop\s+column\b/i, why: 'dropping a column' },
  /*
   * The quiet one, and the reason this list grew.
   *
   * DELETE and DROP announce themselves: the table is empty, the app breaks,
   * you know within minutes. An UPDATE with no WHERE succeeds, reports a row
   * count nobody reads, and leaves a database that still works — every row now
   * holding the same value. On this project that is a season of tray
   * assignments or scan positions rewritten to one figure, discovered whenever
   * someone next looks at a report.
   *
   * `on conflict … do update set` is the common false positive and is excluded
   * by the lookbehind: an upsert legitimately has no WHERE, and this repo's
   * importers are built on it (see the tray identity rule in CLAUDE.md). A
   * guard that refuses those would be turned off within a week.
   */
  {
    pattern: /(?<!\bdo\s+)\bupdate\s+(?:only\s+)?[\w."]+\s+set\b(?![^;]*\bwhere\b)/i,
    why: 'an UPDATE with no WHERE — that rewrites every row',
  },
]

/**
 * The first guard this SQL trips, or null. Comments and literals are ignored.
 */
export function refusalFor(sql) {
  const code = stripSqlComments(sql)
  return REFUSE.find((g) => g.pattern.test(code)) ?? null
}
