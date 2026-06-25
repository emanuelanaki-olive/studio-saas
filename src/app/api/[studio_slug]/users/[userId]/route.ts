/**
 * src/app/api/[studio_slug]/users/[userId]/route.ts
 *
 * GET   -> full profile for one user, including their memberships
 *          and recent bookings (the CRM "client detail" view)
 * PATCH -> update CRM fields (owner/staff), or a client updating
 *          their own contact info / health declaration
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const PatchUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  clientStatus: z.enum(["lead", "active", "inactive", "frozen"]).optional(),
  healthDeclaration: z.boolean().optional(),
  medicalNotes: z.string().optional(),
  birthDate: z.string().date().optional(),
});

export const GET = withApiErrorHandling(async (_req, ctx) => {
  const session = await requireStudioAccess();
  const { userId } = await ctx.params;

  // Clients can only ever view their own profile this way; staff/owner
  // can view anyone's.
  if (session.role === "client" && session.userId !== userId) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const db = getTenantDb(session.studioId);
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { orderBy: { createdAt: "desc" } },
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { class: { select: { title: true, startTime: true } } },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ user });
});

export const PATCH = withApiErrorHandling(async (req, ctx) => {
  const session = await requireStudioAccess();
  const { userId } = await ctx.params;

  if (session.role === "client" && session.userId !== userId) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const body = await req.json();
  const parsed = PatchUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // A client editing their own profile can only touch contact info
  // and their own health declaration — not clientStatus, which is a
  // staff-only operational field (e.g. marking someone "inactive").
  if (session.role === "client" && parsed.data.clientStatus !== undefined) {
    return NextResponse.json(
      { error: "Clients cannot change their own status." },
      { status: 403 }
    );
  }

  const db = getTenantDb(session.studioId);
  const user = await db.user.update({
    where: { id: userId },
    data: {
      ...parsed.data,
      birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : undefined,
    },
  });

  return NextResponse.json({ user });
});
