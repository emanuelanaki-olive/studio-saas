/**
 * src/app/api/studios/route.ts
 *
 * This route is intentionally OUTSIDE the [studio_slug] segment: a
 * studio doesn't exist yet when it's being created, and looking up
 * "does this slug exist" must happen pre-tenant-resolution (e.g. on
 * a signup form's live slug-availability check).
 *
 * POST -> full studio signup: creates a real Supabase Auth user
 *         (with the password the owner chose), then creates the
 *         Studio + owner User row using THAT SAME id. If anything
 *         after the Supabase signup fails, we delete the auth user
 *         so a failed signup doesn't leave an orphaned login with no
 *         matching studio.
 *
 * In production, consider putting this behind rate limiting — it's
 * a public, unauthenticated endpoint by design (this is how new
 * studios sign themselves up).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { unscopedDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CreateStudioSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(slugPattern, "Slug must be lowercase letters, numbers, and hyphens only."),
  // The first user created becomes the studio's owner.
  ownerEmail: z.string().email(),
  ownerFullName: z.string().min(1),
  ownerPassword: z.string().min(8, "Password must be at least 8 characters."),
});

export const POST = withApiErrorHandling(async (req) => {
  const body = await req.json();
  const parsed = CreateStudioSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, slug, ownerEmail, ownerFullName, ownerPassword } = parsed.data;

  const existingSlug = await unscopedDb.studio.findUnique({ where: { slug } });
  if (existingSlug) {
    return NextResponse.json({ error: "This slug is already taken." }, { status: 409 });
  }

  // 1. Create the real Supabase Auth user first. We use the admin
  //    client + email_confirm: true so the owner can log in
  //    immediately without waiting on a confirmation email — adjust
  //    if you want email verification before first login.
  const supabaseAdmin = createSupabaseAdminClient();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    const status = authError?.status === 422 ? 409 : 500;
    return NextResponse.json(
      { error: authError?.message ?? "Could not create the account." },
      { status }
    );
  }

  const authUserId = authData.user.id;

  // 2. Create the Studio + owner User row using THAT id. If this
  //    fails for any reason, delete the auth user we just created —
  //    otherwise we'd leave behind a login with no studio attached.
  try {
    const studio = await unscopedDb.$transaction(async (tx) => {
      const newStudio = await tx.studio.create({
        data: { name, slug },
      });

      await tx.user.create({
        data: {
          id: authUserId,
          studioId: newStudio.id,
          email: ownerEmail,
          fullName: ownerFullName,
          role: "owner",
        },
      });

      return newStudio;
    });

    return NextResponse.json({ studio }, { status: 201 });
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {
      // If even the cleanup fails, this orphaned auth user will need
      // manual removal from the Supabase dashboard — logged below so
      // it isn't silently lost.
      console.error(
        `Orphaned Supabase auth user after failed signup: ${authUserId} (${ownerEmail})`
      );
    });
    throw err;
  }
});

export const GET = withApiErrorHandling(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");

  if (slug) {
    // Used by signup forms for live "is this slug available" checks.
    const studio = await unscopedDb.studio.findUnique({ where: { slug } });
    return NextResponse.json({ available: !studio });
  }

  return NextResponse.json({ error: "Missing slug query param." }, { status: 400 });
});
