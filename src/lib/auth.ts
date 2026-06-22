/**
 * src/lib/auth.ts
 *
 * Session + tenant-membership verification, backed by Supabase Auth.
 *
 * How this connects to Supabase:
 *   - `users.id` in our Prisma schema is the SAME UUID as Supabase's
 *     `auth.users.id`. When someone signs up, we create our `User`
 *     row using the id Supabase gave us (see
 *     src/app/api/studios/route.ts for studio owner signup, and
 *     src/app/api/[studio_slug]/users/route.ts for adding clients/
 *     staff), instead of letting Prisma generate its own UUID.
 *   - That means once we have the Supabase session's user id, a
 *     single `users` lookup tells us everything else: which studio
 *     they belong to and what role they have.
 *
 * requireStudioAccess() is the single entry point every Route
 * Handler / Server Action / Server Component should call before
 * touching tenant data. It does NOT know or care that Supabase is
 * the auth provider underneath — if you ever swap to Clerk, only
 * getAuthenticatedUserId() below needs to change.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { unscopedDb } from "./db";
import { createSupabaseServerClient } from "./supabase-server";
import { UserRole } from "@prisma/client";

export class UnauthorizedError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}
export class NotFoundError extends Error {
  status = 404;
}

export interface SessionContext {
  userId: string;
  studioId: string;
  studioSlug: string;
  role: UserRole;
}

/**
 * Call this at the top of every Route Handler / Server Action that
 * touches tenant data. It:
 *   1. Resolves the studio from the slug in the URL (set by middleware).
 *   2. Loads the current authenticated Supabase user.
 *   3. Verifies the user actually belongs to THAT studio
 *      (or is a super_admin, who can access any studio explicitly).
 *   4. Optionally enforces a minimum role.
 *
 * Throws on any failure — callers should let these errors bubble to
 * a shared error handler that maps them to HTTP status codes (see
 * src/lib/api-handler.ts).
 */
export async function requireStudioAccess(opts?: {
  minRole?: UserRole[];
}): Promise<SessionContext> {
  const headerList = await headers();
  const studioSlug = headerList.get("x-studio-slug");

  if (!studioSlug) {
    throw new NotFoundError("No studio specified in the request path.");
  }

  // 1. Resolve the studio. Deliberately uses the UNSCOPED client —
  //    this is the one legitimate lookup that must happen before we
  //    have a studioId at all.
  const studio = await unscopedDb.studio.findUnique({
    where: { slug: studioSlug },
  });

  if (!studio || studio.status === "suspended") {
    throw new NotFoundError("Studio not found or inactive.");
  }

  // 2. Resolve the authenticated user from the real Supabase session.
  const authUserId = await getAuthenticatedUserId();
  if (!authUserId) {
    throw new UnauthorizedError("Not signed in.");
  }

  const user = await unscopedDb.user.findUnique({
    where: { id: authUserId },
  });

  if (!user) {
    // The person has a valid Supabase session but no matching row in
    // our `users` table yet — e.g. they verified their email but the
    // studio/user-creation step never completed. Treat as signed out
    // rather than crashing.
    throw new UnauthorizedError("Account setup incomplete. Please contact support.");
  }

  // 3. Verify tenant membership. super_admin bypasses the studioId
  //    match (platform admins can inspect any studio), everyone else
  //    must belong to exactly this studio.
  if (user.role !== "super_admin" && user.studioId !== studio.id) {
    throw new ForbiddenError("You do not have access to this studio.");
  }

  // 4. Optional role gate, e.g. requireStudioAccess({ minRole: ["owner"] })
  //    for endpoints only the studio owner should hit.
  if (opts?.minRole && !opts.minRole.includes(user.role) && user.role !== "super_admin") {
    throw new ForbiddenError(`Requires one of role(s): ${opts.minRole.join(", ")}.`);
  }

  return {
    userId: user.id,
    studioId: studio.id,
    studioSlug: studio.slug,
    role: user.role,
  };
}

/**
 * Resolves the current Supabase session's user id, if any.
 *
 * Uses supabase.auth.getUser() (not getSession()) deliberately —
 * getUser() re-validates the token against Supabase's servers on
 * every call, while getSession() trusts whatever is in the cookie.
 * For server-side authorization checks like this one, the extra
 * round trip is the right trade-off: we never want to grant tenant
 * access based on an unverified cookie value.
 */
async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user.id;
}

/**
 * Use this instead of requireStudioAccess() directly inside a
 * Server Component PAGE (not a Route Handler). Route Handlers have
 * withApiErrorHandling() to turn thrown errors into JSON responses,
 * but a page has no equivalent — an uncaught throw there renders
 * Next's generic error screen, which is a poor experience for
 * "you're just not logged in yet."
 *
 * This redirects to /login on UnauthorizedError/ForbiddenError
 * instead of throwing, and re-throws anything else (e.g.
 * NotFoundError) so Next's not-found handling still applies.
 */
export async function requireStudioAccessForPage(opts?: {
  minRole?: UserRole[];
}): Promise<SessionContext> {
  try {
    return await requireStudioAccess(opts);
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      redirect("/login");
    }
    throw err;
  }
}
