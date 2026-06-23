/**
 * src/lib/supabase-server.ts
 *
 * Supabase client for use in Server Components, Route Handlers, and
 * Server Actions. Reads/writes the auth session via Next.js cookies.
 *
 * Do NOT import this from Client Components — use a separate browser
 * client (src/lib/supabase-browser.ts) there instead, since cookie
 * access works differently on the client.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { CookieOptions } from "@supabase/ssr";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          // In a Server Component (not a Route Handler/Server Action),
          // calling cookieStore.set() throws because Server Components
          // can't write cookies. We swallow that here — middleware.ts
          // is responsible for refreshing the session cookie on every
          // request, so a failed set() in this context is harmless.
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // no-op — see comment above
          }
        },
      },
    }
  );
}
