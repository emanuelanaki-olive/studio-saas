"use client";

/**
 * src/lib/supabase-browser.ts
 *
 * Supabase client for use in Client Components (e.g. the login form,
 * which needs to call supabase.auth.signInWithOtp / signInWithPassword
 * directly from the browser).
 */

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
