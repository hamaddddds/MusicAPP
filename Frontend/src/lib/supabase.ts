/**
 * Supabase client for GitHub Auth + Follows.
 *
 * Environment variables (set in .env or injected by Tauri / Vite):
 *   VITE_SUPABASE_URL   — your Supabase project URL
 *   VITE_SUPABASE_ANON  — your Supabase anon/public key
 *
 * Both must be set or the client falls back to `null` and
 * all Supabase features silently become no-ops.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL  = import.meta.env.VITE_SUPABASE_URL  ?? "";
const ANON = import.meta.env.VITE_SUPABASE_ANON ?? "";

export const supabase: SupabaseClient | null =
  URL && ANON ? createClient(URL, ANON) : null;
