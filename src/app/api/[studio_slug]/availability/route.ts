/**
 * src/app/api/[studio_slug]/availability/route.ts
 *
 * GET  -> list availability blocks, optionally filtered by
 *         ?providerId= (used to render "book with this instructor"
 *         and the instructor's own schedule-management view)
 * POST -> create a new recurring availability block (owner/staff -
 *         a staff member typically sets their own hours; an owner
 *         can also set them on behalf of staff)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateAvailabilitySchema = z.object({
  providerId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess();
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const providerId = url.searchParams.get("providerId") ?? undefined;

  const blocks = await db.availabilityBlock.findMany({
    where: { providerId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });

  return NextResponse.json({ blocks });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateAvailabilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { providerId, dayOfWeek, startMinute, endMinute } = parsed.data;

  if (endMinute <= startMinute) {
    return NextResponse.json(
      { error: "endMinute must be after startMinute." },
      { status: 400 }
    );
  }

  // Staff can only set their OWN availability; owners can set it for
  // anyone (e.g. setting up a new instructor's schedule for them).
  if (session.role === "staff" && providerId !== session.userId) {
    return NextResponse.json(
      { error: "You can only set your own availability." },
      { status: 403 }
    );
  }

  const block = await db.availabilityBlock.create({
    data: {
      // studioId is also auto-injected by getTenantDb()'s extension at
      // runtime, but Prisma's generated types require it statically.
      studioId: session.studioId,
      providerId,
      dayOfWeek,
      startMinute,
      endMinute,
    },
  });

  return NextResponse.json({ block }, { status: 201 });
});
