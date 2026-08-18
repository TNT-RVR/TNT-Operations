#!/usr/bin/env node
/**
 * Push the built auth email templates into Supabase.
 *
 * Replaces pasting six HTML blobs into the dashboard by hand. Supabase's
 * Management API can set the auth mailer config directly, so a wording change
 * becomes: edit scripts/build_email_templates.py, rebuild, run this.
 *
 *   node scripts/build_email_templates.py   # or: npm run email:build
 *   npm run email:push -- --dry-run         # show what would change
 *   npm run email:push
 *
 * ── The token ────────────────────────────────────────────────────────────────
 *
 * Needs a Supabase **personal access token** (dashboard → Account → Access
 * Tokens), in `SUPABASE_ACCESS_TOKEN`, either as a real environment variable or
 * in `.env.local` (already gitignored).
 *
 * Treat it as the most dangerous secret in this repo. Unlike the service-role
 * key it is not scoped to a project — it is your whole Supabase ACCOUNT, and
 * this account also holds the old beetent-maps app's data. It never belongs in
 * a `VITE_` var (that would ship it to browsers), in Netlify, or in a commit.
 * Revoke it from the same page the moment it is not needed.
 *
 * ── Why it refuses more than it sends ────────────────────────────────────────
 *
 * A template that lost its `{{ .ConfirmationURL }}` still renders as a perfect
 * email with a dead button, and nothing downstream would notice — the send
 * succeeds, the person just can never get in. So every file is checked for the
 * placeholder its template type requires before anything is uploaded, and one
 * bad file stops the whole push rather than half-updating the set.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATES = join(ROOT, 'supabase', 'email-templates')
const DEFAULT_REF = 'pmqbkezevsuwkoryxief' // the shared project; see CLAUDE.md

/**
 * file → the Management API's two field names + the subject line.
 * Field names from Supabase's auth email template docs; the `_content` suffix
 * is theirs, not ours.
 */
const MAILS = [
  {
    file: 'invite.html',
    content: 'mailer_templates_invite_content',
    subjectKey: 'mailer_subjects_invite',
    subject: "You've been added to TNT Operations",
    requires: '{{ .ConfirmationURL }}',
  },
  {
    file: 'magic-link.html',
    content: 'mailer_templates_magic_link_content',
    subjectKey: 'mailer_subjects_magic_link',
    subject: 'Your link to TNT Operations',
    requires: '{{ .ConfirmationURL }}',
  },
  {
    file: 'reset-password.html',
    content: 'mailer_templates_recovery_content',
    subjectKey: 'mailer_subjects_recovery',
    subject: 'Reset your TNT Operations password',
    requires: '{{ .ConfirmationURL }}',
  },
  {
    file: 'confirm-signup.html',
    content: 'mailer_templates_confirmation_content',
    subjectKey: 'mailer_subjects_confirmation',
    subject: 'Confirm your email address',
    requires: '{{ .ConfirmationURL }}',
  },
  {
    file: 'change-email.html',
    content: 'mailer_templates_email_change_content',
    subjectKey: 'mailer_subjects_email_change',
    subject: 'Confirm your new email address',
    requires: '{{ .ConfirmationURL }}',
  },
  {
    file: 'reauthentication.html',
    content: 'mailer_templates_reauthentication_content',
    subjectKey: 'mailer_subjects_reauthentication',
    subject: 'Your TNT Operations confirmation code',
    requires: '{{ .Token }}',
  },
]

/** Minimal KEY=value reader — no dependency for one secret. */
function fromEnvFile(key) {
  const path = join(ROOT, '.env.local')
  if (!existsSync(path)) return null
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

function die(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')
const ref = process.env.SUPABASE_PROJECT_REF || fromEnvFile('SUPABASE_PROJECT_REF') || DEFAULT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN || fromEnvFile('SUPABASE_ACCESS_TOKEN')

if (!token && !dryRun) {
  die(
    'No SUPABASE_ACCESS_TOKEN.\n' +
      '  Create a personal access token at https://supabase.com/dashboard/account/tokens\n' +
      '  then add to .env.local (gitignored):  SUPABASE_ACCESS_TOKEN=sbp_...',
  )
}

// ── Read and vet every file before sending any of it ─────────────────────────
const body = {}
console.log(`Templates from supabase/email-templates → project ${ref}`)
for (const mail of MAILS) {
  const path = join(TEMPLATES, mail.file)
  if (!existsSync(path)) die(`Missing ${mail.file}. Run: npm run email:build`)
  const html = readFileSync(path, 'utf8')
  if (!html.includes(mail.requires)) {
    die(
      `${mail.file} is missing ${mail.requires}.\n` +
        '  That placeholder is how Supabase injects the link or code — without it the\n' +
        '  mail arrives looking perfect and does nothing. Nothing was pushed.',
    )
  }
  body[mail.content] = html
  body[mail.subjectKey] = mail.subject
  console.log(`  ${mail.file.padEnd(24)} ${(html.length / 1024).toFixed(1)} KB → ${mail.content}`)
}

if (dryRun) {
  console.log('\n--dry-run: nothing sent.')
  process.exit(0)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

if (!res.ok) {
  const text = await res.text().catch(() => '')
  if (res.status === 401) die('Supabase rejected the token (401). It may be expired or revoked.')
  if (res.status === 404) die(`No project "${ref}" on this account (404). Check SUPABASE_PROJECT_REF.`)
  die(`Supabase returned ${res.status}. ${text.slice(0, 300)}`)
}

console.log(`\n✓ Pushed ${MAILS.length} templates and subjects to ${ref}.`)
console.log('  Send yourself one from Users & Settings → Users to confirm.')
