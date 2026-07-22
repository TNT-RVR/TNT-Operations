/**
 * Supabase browser client. Reads the PUBLIC url + anon key from Vite env
 * (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Both are safe to ship to the
 * browser; the service_role key must NEVER appear here (see CLAUDE.md).
 *
 * Returns `null` when unconfigured so importing this never throws — `DataProvider`
 * checks {@link isSupabaseConfigured} and falls back to mock data with a warning.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null
