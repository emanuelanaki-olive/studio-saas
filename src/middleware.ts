/**
 * src/middleware.ts
 *
 * Does TWO jobs on every request:
 *
 *   1. Tenant resolution: PATH-BASED.
 *        https://app.domain.com/[studio_slug]/dashboard
 *        https://app.domain.com/[studio_slug]/portal
 *      Resolves the studio_slug from the URL and forwards it as a
 *      request header so downstream Server Components / Route
 *      Handlers can read it via `headers()`.
 *
 *   2. Refreshes the Supabase Auth session cookie. Required by
 *      @supabase/ssr: access tokens are short-lived, and middleware
 *      is the one place guaranteed to run before every request, so
 *      it's where Supabase's docs say the refresh belongs. Without
 *      this, sessions would silently expire mid-use.
 *
 * ORDER MATTERS: we build the request headers (with x-studio-slug)
 * FIRST, create the response from those headers, and only THEN let
 * Supabase write its refreshed cookies onto that same response. Doing
 * it in the other order risks Supabase's `NextResponse.next()` call
 * silently dropping the slug header we set.
 *
 * This middleware does NOT do the final authorization check — it
 * only resolves which studio the request is *for*. The actual "is
 * this user allowed into this studio" check happens in
 * src/lib/auth.ts -> requireStudioAccess(), which every API route,
 * Server Action, and tenant-scoped Server Component must call.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

// Routes that don't have a studio_slug segment at all (marketing
// site, auth pages, the signup/login API, Next internals).
const PUBLIC_PATH_PREFIXES = [
  "/api/studios",
  "/api/me",
  "/_next",
  "/favicon.ico",
  "/login",
  "/signup",
];

export async function middleware(request: NextRequest) {
  // --- 1. Tenant slug resolution ---
  const { pathname } = request.nextUrl;
  const isPublicPath = pathname === "/" || PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));

  const requestHeaders = new Headers(request.headers);
  if (!isPublicPath) {
    // Expect /[studio_slug]/... for both dashboard and portal routes,
    // and /api/[studio_slug]/... for tenant-scoped API routes.
    const segments = pathname.split("/").filter(Boolean);
    const studioSlug = segments[0] === "api" ? segments[1] : segments[0];
    if (studioSlug) {
      // DO NOT trust this header as proof of access — it is only a
      // hint for which tenant to look up. requireStudioAccess()
      // re-derives and verifies membership against the authenticated
      // session on every request.
      requestHeaders.set("x-studio-slug", studioSlug);
    }
  }

  // Build the response from headers that already include the slug,
  // so anything Supabase does below builds on top of this, not the
  // other way around.
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // --- 2. Supabase session refresh ---
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Write refreshed cookies onto the SAME response object we
          // already created above, rather than constructing a new
          // one — this is what preserves the x-studio-slug header.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  // Touching getUser() is what actually triggers the refresh-if-needed
  // logic inside the Supabase client, which then calls setAll() above
  // if the token needed refreshing.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets.
     */
    "/((?!_next/static|_next/image|.*\\.[\\w]+$).*)",
  ],
};

/* -------------------------------------------------------------
 * ALTERNATIVE: Sub-domain based resolution
 * -------------------------------------------------------------
 * If you later move to studio_slug.yourapp.com instead of
 * yourapp.com/studio_slug, swap the slug extraction above for:
 *
 *   const host = request.headers.get("host") ?? "";
 *   const studioSlug = host.split(".")[0]; // "acme" from acme.yourapp.com
 *
 * Everything downstream (requireStudioAccess, getTenantDb) stays
 * identical — only this one extraction line changes.
 * ----------------------------------------------------------- */
