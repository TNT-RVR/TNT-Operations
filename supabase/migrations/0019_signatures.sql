-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — electronic signatures.
--
-- ── The stamp and the impression ─────────────────────────────────────────────
--
-- Two tables, and the distinction between them is the privacy model:
--
--   user_signatures      YOUR signature image. Private to you — nobody else can
--                        read it, not even an admin. This is the STAMP, and only
--                        you can pick it up.
--   document_signatures  the record of a signature having been APPLIED. Readable
--                        by anyone who can see the document, because a signed
--                        document has to be able to show its signature. This is
--                        the IMPRESSION, and it is public by necessity.
--
-- So: nobody can take your signature and put it on something. Once you put it
-- on something yourself, it is visible on that thing. That is how a rubber stamp
-- in a drawer works, and it is the behaviour asked for.
--
-- ── What makes the record hold up ────────────────────────────────────────────
--
-- An image proves nothing on its own. The evidentiary weight is in:
--   intent      the attestation text the signer agreed to, stored verbatim
--   attribution the authenticated user id, name and email at signing time
--   integrity   content_hash — SHA-256 of exactly what was signed
--   time        signed_at defaults to now() SERVER-SIDE; a browser clock is set
--               by the user and is worth nothing as evidence
--
-- See src/domain/signature.ts. Everything here is append-only: a signature is
-- never updated or deleted, only VOIDED, because destroying the record of a
-- signature destroys the evidence that it happened.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- The stamp — private per user
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.user_signatures (
  -- One signature per person. Replacing it overwrites this row; documents
  -- already signed keep their own copy (see signature_image below).
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  -- A data: URL. Inline rather than in Storage so the privacy rule lives in one
  -- place — a bucket policy is a second thing to get right, and this is small.
  image       text not null,
  -- Printed under the signature: 'Owner', 'President'.
  title       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ~256 KB of base64 ≈ 350 KB of text. Anything larger is a photo that should
  -- have been cropped.
  constraint signature_image_size check (length(image) < 400000)
);

alter table public.user_signatures enable row level security;

-- OWNER ONLY. Deliberately no admin exception: an admin who could read this
-- could sign as you, which defeats the point of a signature. The four policies
-- are spelled out separately rather than using FOR ALL so that the intent is
-- unmistakable to whoever reads this next.
drop policy if exists "read own signature" on public.user_signatures;
create policy "read own signature" on public.user_signatures
  for select using (user_id = auth.uid());

drop policy if exists "insert own signature" on public.user_signatures;
create policy "insert own signature" on public.user_signatures
  for insert with check (user_id = auth.uid());

drop policy if exists "update own signature" on public.user_signatures;
create policy "update own signature" on public.user_signatures
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own signature" on public.user_signatures;
create policy "delete own signature" on public.user_signatures
  for delete using (user_id = auth.uid());

drop trigger if exists user_signatures_touch_updated_at on public.user_signatures;
create trigger user_signatures_touch_updated_at before update on public.user_signatures
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- The impression — the signature record
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.document_signatures (
  id            uuid primary key default gen_random_uuid(),

  -- What was signed.
  document_kind text not null,
  document_id   uuid not null,
  -- Printed reference, e.g. 'INV-2026-014'. Denormalised so the record still
  -- reads correctly if the order is renumbered or deleted.
  document_ref  text not null default '',

  -- Who signed. Denormalised ON PURPOSE: the record must say who signed it at
  -- the time, even if they later change their name or leave.
  signer_id     uuid references public.profiles (id) on delete set null,
  signer_name   text not null,
  signer_email  text not null,
  signer_title  text not null default '',

  -- SERVER time. Never accepted from the client.
  signed_at     timestamptz not null default now(),

  -- SHA-256 of the canonical form of what was signed. Re-hash and compare to
  -- detect any change since.
  content_hash  text not null,
  -- The exact wording agreed to, so amending the app's attestation text later
  -- cannot rewrite what someone actually consented to.
  attestation   text not null,

  -- A COPY of the signature image as it looked when applied. Without this,
  -- changing your signature image would retroactively alter every document you
  -- had already signed.
  signature_image text not null,

  -- Best-effort environment evidence. Captured server-side; the browser cannot
  -- see its own public IP, and could lie about it if it could.
  ip_address    text,
  user_agent    text,

  -- Voiding, rather than deleting. Destroying the record destroys the evidence
  -- that the signature happened at all.
  voided_at     timestamptz,
  voided_by     uuid references public.profiles (id) on delete set null,
  void_reason   text not null default ''
);

create index if not exists document_signatures_doc_idx
  on public.document_signatures (document_kind, document_id);
create index if not exists document_signatures_signer_idx on public.document_signatures (signer_id);

alter table public.document_signatures enable row level security;

-- Readable by any member: a signed document has to show its signature.
drop policy if exists "read for members" on public.document_signatures;
create policy "read for members" on public.document_signatures for select using (has_access());

-- You may only record a signature AS YOURSELF. The check on signer_id is what
-- stops one user signing in another's name.
drop policy if exists "sign as yourself" on public.document_signatures;
create policy "sign as yourself" on public.document_signatures
  for insert with check (has_access() and signer_id = auth.uid());

-- Voiding is the only permitted change, and only by the signer or an admin.
-- No delete policy exists at all, so the row cannot be removed through the API.
drop policy if exists "void own signature" on public.document_signatures;
create policy "void own signature" on public.document_signatures
  for update using (has_access() and (signer_id = auth.uid() or app_role() = 'admin'))
  with check (has_access() and (signer_id = auth.uid() or app_role() = 'admin'));

-- Append-only enforcement. RLS decides WHO may write; this decides WHAT may
-- change — everything except the void columns is immutable once written, so a
-- permitted "void" update cannot quietly rewrite the hash or the signer.
create or replace function public.fn_document_signature_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.document_kind is distinct from old.document_kind
     or new.document_id is distinct from old.document_id
     or new.signer_id is distinct from old.signer_id
     or new.signer_name is distinct from old.signer_name
     or new.signer_email is distinct from old.signer_email
     or new.signed_at is distinct from old.signed_at
     or new.content_hash is distinct from old.content_hash
     or new.attestation is distinct from old.attestation
     or new.signature_image is distinct from old.signature_image then
    raise exception 'A signature record is immutable. Void it instead.';
  end if;
  return new;
end $$;

drop trigger if exists document_signature_immutable on public.document_signatures;
create trigger document_signature_immutable before update on public.document_signatures
  for each row execute function public.fn_document_signature_immutable();

-- The client must not be able to backdate a signature. Overwrite whatever it
-- sent with the database's own clock.
create or replace function public.fn_document_signature_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.signed_at := now();
  return new;
end $$;

drop trigger if exists document_signature_stamp on public.document_signatures;
create trigger document_signature_stamp before insert on public.document_signatures
  for each row execute function public.fn_document_signature_stamp();

-- ═══════════════════════════════════════════════════════════════════════════
-- Signatory title on the profile
-- ═══════════════════════════════════════════════════════════════════════════

-- Lives on the signature rather than the profile, but a default here means the
-- Account tab has one obvious place to set it.
alter table public.profiles add column if not exists title text not null default '';
