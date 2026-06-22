/**
 * src/app/api/[studio_slug]/classes/route.ts
 *
 * GET  -> list classes (calendar view, supports ?from=&to= range)
 * POST -> create a class (owner/staff only)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateClassSchema = z.object({
  title: z.string().min(1).max(200),
  instructorId: z.string().uuid().optional(),
  capacity: z.number().int().positive(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  recurrenceRule: z.string().optional(),
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess();
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const classes = await db.class.findMany({
    where: {
      ...(from || to
        ? {
            startTime: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: {
      instructor: { select: { id: true, fullName: true } },
      _count: { select: { bookings: true } },
    },
    orderBy: { startTime: "asc" },
  });

  return NextResponse.json({ classes });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateClassSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (new Date(parsed.data.endTime) <= new Date(parsed.data.startTime)) {
    return NextResponse.json({ error: "endTime must be after startTime." }, { status: 400 });
  }

  const klass = await db.class.create({
    data: {
      title: parsed.data.title,
      instructorId: parsed.data.instructorId,
      capacity: parsed.data.capacity,
      startTime: new Date(parsed.data.startTime),
      endTime: new Date(parsed.data.endTime),
      recurrenceRule: parsed.data.recurrenceRule,
    },
  });

  return NextResponse.json({ class: klass }, { status: 201 });
});
