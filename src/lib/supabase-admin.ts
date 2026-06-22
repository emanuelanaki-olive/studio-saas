/**
 * src/lib/supabase-admin.ts
 *
 * Supabase client using the SERVICE ROLE key — bypasses Row Level
 * Security and can create auth users directly (no email-confirmation
 * round trip required). Use ONLY in trusted server-side code that
 * never runs in the browser: studio signup, and any future
 * super_admin tooling.
 *
 * NEVER import this from a Client Component or expose
 * SUPABASE_SERVICE_ROLE_KEY to the browser — it grants full
 * database/auth access, bypassing every RLS policy.
 */

import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
