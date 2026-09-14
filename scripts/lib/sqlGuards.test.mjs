/**
 * The run-sql seatbelt.
 *
 * Two failure directions, and the cheap one is not the dangerous one:
 *
 *   A guard that stops matching lets an irreversible statement through, and the
 *   silence looks exactly like a safe migration.
 *
 *   A guard that matches too much refuses legitimate work — and a script that
 *   refuses the migration you need gets bypassed, which removes every guard at
 *   once. That is the direction this repo is actually exposed to, because its
 *   migrations are heavily commented and built on upserts.
 *
 * So both directions are pinned.
 */
import { describe, expect, it } from 'vitest'
import { refusalFor, stripSqlComments } from './sqlGuards.mjs'

const refused = (sql) => refusalFor(sql) !== null

describe('the statements run-sql refuses', () => {
  it('catches the irreversible ones', () => {
    expect(refused('drop table public.trays')).toBe(true)
    expect(refused('truncate public.sensor_readings')).toBe(true)
    expect(refused('delete from public.trays')).toBe(true)
    expect(refused('alter table public.trays drop column tray_number')).toBe(true)
  })

  it('lets a qualified DELETE through', () => {
    expect(refused("delete from public.trays where sample_id = 'x'")).toBe(false)
  })

  /*
   * The one this list was extended for. An UPDATE with no WHERE does not look
   * like a mistake afterwards: it succeeds, the app still works, and every row
   * holds the same value until someone reads a report.
   */
  describe('an UPDATE with no WHERE', () => {
    it('is refused', () => {
      expect(refused("update public.trays set incubator_id = 'abc'")).toBe(true)
      expect(refused('UPDATE ONLY public.field_seasons SET acres = 0')).toBe(true)
    })

    it('is allowed once it names its rows', () => {
      expect(refused("update public.trays set incubator_id = 'abc' where id = 'def'")).toBe(false)
    })

    it('still allows a WHERE on the next line', () => {
      expect(refused('update public.trays\n  set incubator_id = null\n  where in_date is null')).toBe(
        false,
      )
    })

    /*
     * An upsert has no WHERE and never did. `import_incubation.py` emits these
     * by the thousand, and the tray identity rule in CLAUDE.md asks for more of
     * them — refusing this would refuse the imports.
     */
    it('does not refuse an upsert', () => {
      const sql =
        'insert into public.trays (sample_id, tray_number, incubator_id) values ($1, $2, $3)\n' +
        '  on conflict (sample_id, tray_number) do update set incubator_id = excluded.incubator_id'
      expect(refused(sql)).toBe(false)
    })

    it('does not refuse a locking SELECT', () => {
      expect(refused('select * from public.trays where id = $1 for update')).toBe(false)
    })
  })
})

describe('reading past comments and literals', () => {
  /*
   * Every migration in this repo opens with a paragraph explaining itself, and
   * those paragraphs talk about the operations they perform. Guarding the raw
   * text refuses the file for describing itself.
   */
  it('ignores prose in a line comment', () => {
    expect(refused('-- a tray that moves must update trays set incubator_id\nselect 1')).toBe(false)
  })

  it('ignores prose in a block comment, including a nested one', () => {
    expect(refused('/* drop table t /* as we once nearly did */ */\nselect 1')).toBe(false)
  })

  it('ignores a string that happens to contain a keyword', () => {
    expect(refused("insert into audit (note) values ('drop table public.fields')")).toBe(false)
  })

  /*
   * A SECURITY DEFINER trigger body is not a statement being run now. Several
   * of this project's triggers legitimately UPDATE, and reading their bodies as
   * live statements refuses the migrations that install them.
   */
  it('ignores a dollar-quoted function body', () => {
    const sql =
      'create function fn_touch() returns trigger language plpgsql as $$\n' +
      'begin\n  update public.placed_shelters set field_season_id = fn_season_for(new.field_id, now());\n' +
      '  return new;\nend $$;'
    expect(refused(sql)).toBe(false)
  })

  it('still catches the real statement beside the prose', () => {
    expect(refused('-- harmless note\nupdate public.trays set incubator_id = null;')).toBe(true)
  })

  /*
   * Stripping must not let neighbouring words fuse into a keyword that was
   * never written, so removed spans keep their length.
   */
  it('preserves offsets so nothing joins up', () => {
    const sql = 'select 1; /* xx */ select 2;'
    expect(stripSqlComments(sql)).toHaveLength(sql.length)
    expect(stripSqlComments(sql)).toBe('select 1;          select 2;')
  })

  it('survives an unterminated comment rather than looping', () => {
    expect(() => stripSqlComments('select 1; /* never closed')).not.toThrow()
    expect(() => stripSqlComments("select 'never closed")).not.toThrow()
    expect(() => stripSqlComments('as $$ never closed')).not.toThrow()
  })
})
