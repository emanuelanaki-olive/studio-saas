/**
 * src/app/api/[studio_slug]/users/route.ts
 *
 * GET  -> list this studio's users (for the CRM view), optionally
 *         filtered by role (?role=client)
 * POST -> owner/staff creates a new client or staff member. Since
 *         every person needs a real Supabase login to ever sign in
 *         (portal or dashboard), this creates a Supabase auth user
 *         too — with a temporary password the studio owner sets and
 *         shares with the person directly (simplest possible flow
 *         for an MVP; swap for an email-invite flow later, see note
 *         below).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const CreateUserSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(["client", "staff"]), // owners are created only via studio signup
  temporaryPassword: z.string().min(8),
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const role = url.searchParams.get("role") ?? undefined;

  const users = await db.user.findMany({
    where: { role: role as "client" | "staff" | "owner" | undefined },
    select: { id: true, fullName: true, email: true, phone: true, role: true, createdAt: true },
    orderBy: { fullName: "asc" },
  });

  return NextResponse.json({ users });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const body = await req.json();
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { fullName, email, phone, role, temporaryPassword } = parsed.data;

  // Only owners can add staff; staff can add clients but not other staff.
  if (role === "staff" && session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can add staff." }, { status: 403 });
  }

  // 1. Create the real Supabase auth user.
  //
  // NOTE on the flow here: this MVP has the owner/staff member set a
  // temporary password and relay it to the new person directly
  // (text message, in person, etc.) — there's no email step. A more
  // typical production flow uses
  // supabaseAdmin.auth.admin.inviteUserByEmail() instead, which sends
  // Supabase's own "set your password" email and needs no password
  // input here at all. Swapping to that is a small, isolated change
  // to this one block.
  const supabaseAdmin = createSupabaseAdminClient();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    const status = authError?.status === 422 ? 409 : 500;
    return NextResponse.json(
      { error: authError?.message ?? "Could not create the account." },
      { status }
    );
  }

  // 2. Create the tenant-scoped User row with that same id.
  try {
    const db = getTenantDb(session.studioId);
    const user = await db.user.create({
      // studioId is also auto-injected by getTenantDb()'s extension at
      // runtime, but Prisma's generated types require it statically.
      data: { id: authData.user.id, studioId: session.studioId, fullName, email, phone, role },
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch(() => {
      console.error(`Orphaned Supabase auth user after failed user creation: ${authData.user.id}`);
    });
    throw err;
  }
});
